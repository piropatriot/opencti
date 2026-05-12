import * as R from 'ramda';
import { Promise as BluePromise } from 'bluebird';
import { stixDomainObjectDelete } from '../../domain/stixDomainObject';
import type { Resolvers } from '../../generated/graphql';
import { ENTITY_TYPE_CONTAINER_CASE } from './case-types';
import { findById, findCasesPaginated, upsertTemplateForCase } from './case-domain';
import { caseTasksPaginated } from '../task/task-domain';
import type { BasicStoreEntityTask } from '../task/task-types';
import { loadParticipants } from '../../database/members';
import { storeLoadById, internalLoadById } from '../../database/middleware-loader';
import { FunctionalError, ForbiddenAccess } from '../../config/errors';
import { BYPASS } from '../../utils/access';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../../schema/general';
import { RELATION_CREATED_BY } from '../../schema/stixRefRelationship';
// Needs to have edit rights or needs to be creator of the case,
// and must share at least one organization with the case's creator.
const checkUserAccess = async (context: any, user: any, id: string) => {
  const userCapabilities = R.flatten(user.capabilities.map((c: any) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const caseEntity = await findById(context, user, id);
  const isCreator = caseEntity[RELATION_CREATED_BY] ? caseEntity[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = caseEntity[RELATION_CREATED_BY];
    if (creatorId) {
      const creator = await internalLoadById(context, user, creatorId);
      const creatorOrgIds = new Set(
        (creator?.objectOrganization || []).map(
          (o: any) => (typeof o === 'string' ? o : (o.internal_id || o.id))
        )
      );
      const userOrgIds = new Set(
        (user.organizations || []).map((o: any) => o.internal_id)
      );
      let sharesOrganization = false;
      for (const orgId of creatorOrgIds) {
        if (userOrgIds.has(orgId as string)) {
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

const caseResolvers: Resolvers = {
  Query: {
    case: (_, { id }, context) => findById(context, context.user, id),
    cases: (_, args, context) => findCasesPaginated(context, context.user, args),
  },
  Case: {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    __resolveType(obj) {
      if (obj.entity_type) {
        return obj.entity_type.replace(/(?:^|-)(\w)/g, (matches, letter) => letter.toUpperCase());
      }
      return 'Unknown';
    },
    tasks: (current, args, context) => caseTasksPaginated<BasicStoreEntityTask>(context, context.user, current.id, args),
    objectParticipant: async (container, _, context) => loadParticipants(context, context.user, container),
  },
  CasesOrdering: {
    creator: 'creator_id',
  },
  Mutation: {
    caseDelete: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      // Load the case to get its actual entity type
      const caseEntity = await storeLoadById(context, context.user, id, ENTITY_TYPE_CONTAINER_CASE);
      if (!caseEntity) {
        throw FunctionalError('Case not found', { id });
      }
      // Use the actual entity type for deletion
      return stixDomainObjectDelete(context, context.user, id, caseEntity.entity_type);
    },
    caseSetTemplate: async (_, { id, caseTemplatesId }, context) => {
      await checkUserAccess(context, context.user, id);
      await BluePromise.map(caseTemplatesId, (caseTemplateId) => upsertTemplateForCase(context, context.user, id, caseTemplateId));
      return findById(context, context.user, id);
    },
  },
};

export default caseResolvers;
