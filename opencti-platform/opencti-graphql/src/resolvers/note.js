import * as R from 'ramda';
import {
  addNote,
  findNotePaginated,
  findById,
  noteContainsStixObjectOrStixRelationship,
  notesDistributionByEntity,
  notesNumber,
  notesNumberByEntity,
  notesTimeSeries,
  notesTimeSeriesByAuthor,
  notesTimeSeriesByEntity,
} from '../domain/note';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { ENTITY_TYPE_CONTAINER_NOTE } from '../schema/stixDomainObject';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { BYPASS, isUserHasCapability, KNOWLEDGE_KNUPDATE } from '../utils/access';
import { ForbiddenAccess } from '../config/errors';
import { resolveUserIndividual } from '../domain/user';
import { isEmptyField } from '../database/utils';
import { internalLoadById } from '../database/middleware-loader';

// Needs to have edit rights or needs to be creator of the note,
// and must share at least one organization with the note's creator.
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const note = await findById(context, user, id);
  const isCreator = note[RELATION_CREATED_BY] ? note[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  // Enforce organization membership: non-bypass users must share at least
  // one organization with the note's creator to prevent cross-org modification.
  if (!isBypass && !isCreator) {
    const creatorId = note[RELATION_CREATED_BY];
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

const noteResolvers = {
  Query: {
    note: (_, { id }, context) => findById(context, context.user, id),
    notes: (_, args, context) => findNotePaginated(context, context.user, args),
    notesTimeSeries: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return notesTimeSeriesByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return notesTimeSeriesByAuthor(context, context.user, args);
      }
      return notesTimeSeries(context, context.user, args);
    },
    notesNumber: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return notesNumberByEntity(context, context.user, args);
      }
      return notesNumber(context, context.user, args);
    },
    notesDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return notesDistributionByEntity(context, context.user, args);
      }
      return [];
    },
    noteContainsStixObjectOrStixRelationship: (_, args, context) => {
      return noteContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  Mutation: {
    noteEdit: (_, { id }, context) => ({
      delete: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_NOTE);
      },
      fieldPatch: async ({ input, commitMessage, references }) => {
        await checkUserAccess(context, context.user, id);
        const isManager = isUserHasCapability(context.user, KNOWLEDGE_KNUPDATE);
        const availableInputs = isManager ? input : input.filter((i) => i.key !== 'createdBy');
        return stixDomainObjectEditField(context, context.user, id, availableInputs, { commitMessage, references });
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
    // For collaborative creation
    userNoteAdd: async (_, { input }, context) => {
      const { user } = context;
      let noteToCreate = { ...input };
      if (isEmptyField(noteToCreate.createdBy)) {
        const individualId = await resolveUserIndividual(context, user);
        noteToCreate = { ...noteToCreate, createdBy: individualId };
      }
      return addNote(context, user, noteToCreate);
    },
    // For knowledge
    noteAdd: async (_, { input }, context) => {
      const { user } = context;
      let noteToCreate = { ...input };
      if (isEmptyField(noteToCreate.createdBy)) {
        const individualId = await resolveUserIndividual(context, user);
        noteToCreate = { ...noteToCreate, createdBy: individualId };
      }
      return addNote(context, context.user, noteToCreate);
    },
  },
};

export default noteResolvers;
