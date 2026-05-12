import * as R from 'ramda';
import { findThreatActorPaginated, findById as threatActorFindById, threatActorCountriesPaginated, threatActorLocationsPaginated } from '../domain/threatActor';
import { addThreatActorGroup, findThreatActorGroupPaginated, findById as groupFindById } from '../domain/threatActorGroup';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDeleteRelation,
  stixDomainObjectDelete,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { ENTITY_TYPE_THREAT_ACTOR_GROUP } from '../schema/stixDomainObject';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { internalLoadById } from '../database/middleware-loader';
import { BYPASS } from '../utils/access';
import { ForbiddenAccess } from '../config/errors';

// Needs to have edit rights or needs to be creator of the threat actor group,
// and must share at least one organization with the group's creator.
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const group = await groupFindById(context, user, id);
  const isCreator = group[RELATION_CREATED_BY] ? group[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = group[RELATION_CREATED_BY];
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
const threatActorGroupResolvers = {
  Query: {
    threatActor: (_, { id }, context) => threatActorFindById(context, context.user, id),
    threatActors: (_, args, context) => findThreatActorPaginated(context, context.user, args),
    threatActorGroup: (_, { id }, context) => groupFindById(context, context.user, id),
    threatActorsGroup: (_, args, context) => findThreatActorGroupPaginated(context, context.user, args),
  },
  ThreatActor: {
    locations: (threatActor, args, context) => threatActorLocationsPaginated(context, context.user, threatActor.id, args),
    countries: (threatActor, args, context) => threatActorCountriesPaginated(context, context.user, threatActor.id, args),
    __resolveType(obj) {
      if (obj.entity_type) {
        return obj.entity_type.replace(/(?:^|-)(\w)/g, (matches, letter) => letter.toUpperCase());
      }
      return 'Unknown';
    },
  },
  Mutation: {
    threatActorGroupAdd: (_, { input }, context) => addThreatActorGroup(context, context.user, input),
    threatActorGroupEdit: (_, { id }, context) => ({
      delete: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_THREAT_ACTOR_GROUP);
      },
      fieldPatch: async ({ input, commitMessage, references }) => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectEditField(context, context.user, id, input, { commitMessage, references });
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
        return stixDomainObjectAddRelation(context, context.user, id, input);
      },
      relationDelete: async ({ toId, relationship_type: relationshipType }) => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDeleteRelation(context, context.user, id, toId, relationshipType);
      },
    }),
  },
};

export default threatActorGroupResolvers;
