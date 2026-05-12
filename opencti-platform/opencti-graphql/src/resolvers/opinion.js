import * as R from 'ramda';
import {
  addOpinion,
  findOpinionsPaginated,
  findById,
  findMyOpinion,
  opinionContainsStixObjectOrStixRelationship,
  opinionsDistributionByEntity,
  opinionsNumber,
  opinionsNumberByEntity,
  opinionsTimeSeries,
  opinionsTimeSeriesByAuthor,
  opinionsTimeSeriesByEntity,
  updateOpinionsMetrics,
} from '../domain/opinion';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { ENTITY_TYPE_CONTAINER_OPINION } from '../schema/stixDomainObject';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { resolveUserIndividual } from '../domain/user';
import { BYPASS, isUserHasCapability, KNOWLEDGE_KNUPDATE } from '../utils/access';
import { ForbiddenAccess } from '../config/errors';
import { isEmptyField } from '../database/utils';
import { internalLoadById } from '../database/middleware-loader';

// Needs to have edit rights or needs to be creator of the opinion,
// and must share at least one organization with the opinion's creator.
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const opinion = await findById(context, user, id);
  const isCreator = opinion[RELATION_CREATED_BY] ? opinion[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  // Enforce organization membership: non-bypass users must share at least
  // one organization with the opinion's creator to prevent cross-org modification.
  if (!isBypass && !isCreator) {
    const creatorId = opinion[RELATION_CREATED_BY];
    if (creatorId) {
      const creator = await internalLoadById(context, user, creatorId);
      const creatorOrgIds = new Set(
        (creator?.objectOrganization || []).map(
          (o) => (typeof o === 'string' ? o : (o.internal_id || o.id))
        )
      );
      const userOrgIds = new Set(
        (user.organizations || []).map((o) => o.internal_id)
      );
      let sharesOrganization = false;
      for (const orgId of creatorOrgIds) {
        if (userOrgIds.has(orgId)) {
          sharesOrganization = true;
          break;
        }
      }
      if (!sharesOrganization) {
        throw ForbiddenAccess();
      }
    }
  }
};

const opinionResolvers = {
  Query: {
    opinion: (_, { id }, context) => findById(context, context.user, id),
    opinions: (_, args, context) => findOpinionsPaginated(context, context.user, args),
    myOpinion: (_, { id }, context) => findMyOpinion(context, context.user, id),
    opinionsTimeSeries: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return opinionsTimeSeriesByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return opinionsTimeSeriesByAuthor(context, context.user, args);
      }
      return opinionsTimeSeries(context, context.user, args);
    },
    opinionsNumber: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return opinionsNumberByEntity(context, context.user, args);
      }
      return opinionsNumber(context, context.user, args);
    },
    opinionsDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return opinionsDistributionByEntity(context, context.user, args);
      }
      return [];
    },
    opinionContainsStixObjectOrStixRelationship: (_, args, context) => {
      return opinionContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  Mutation: {
    opinionEdit: (_, { id }, context) => ({
      delete: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_OPINION);
      },
      fieldPatch: async ({ input, commitMessage, references }) => {
        await checkUserAccess(context, context.user, id);
        const isManager = isUserHasCapability(context.user, KNOWLEDGE_KNUPDATE);
        const availableInputs = isManager ? input : input.filter((i) => i.key !== 'createdBy');
        const opinion = await stixDomainObjectEditField(context, context.user, id, availableInputs, { commitMessage, references });
        await updateOpinionsMetrics(context, context.user, id);
        return opinion;
      },
      contextPatch: async ({ input }) => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectEditContext(context, context.user, id, input);
      },
      contextClean: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectCleanContext(context, context.user, id);
      },
      relationAdd: async ({ input }) => {
        await checkUserAccess(context, context.user, id);
        const rel = await stixDomainObjectAddRelation(context, context.user, id, input);
        await updateOpinionsMetrics(context, context.user, id);
        return rel;
      },
      relationDelete: async ({ toId, relationship_type: relationshipType }) => {
        await checkUserAccess(context, context.user, id);
        const rel = await stixDomainObjectDeleteRelation(context, context.user, id, toId, relationshipType);
        await updateOpinionsMetrics(context, context.user, id);
        return rel;
      },
    }),
    // For collaborative creation
    userOpinionAdd: async (_, { input }, context) => {
      const { user } = context;
      let opinionToCreate = { ...input };
      if (isEmptyField(opinionToCreate.createdBy)) {
        const individualId = await resolveUserIndividual(context, user);
        opinionToCreate = { ...opinionToCreate, createdBy: individualId };
      }
      const opinion = await addOpinion(context, user, opinionToCreate);
      await updateOpinionsMetrics(context, user, opinion.id);
      return opinion;
    },
    // For knowledge
    opinionAdd: async (_, { input }, context) => {
      const { user } = context;
      let opinionToCreate = { ...input };
      if (isEmptyField(opinionToCreate.createdBy)) {
        const individualId = await resolveUserIndividual(context, user);
        opinionToCreate = { ...opinionToCreate, createdBy: individualId };
      }
      const opinion = await addOpinion(context, context.user, opinionToCreate);
      await updateOpinionsMetrics(context, user, opinion.id);
      return opinion;
    },
  },
};

export default opinionResolvers;
