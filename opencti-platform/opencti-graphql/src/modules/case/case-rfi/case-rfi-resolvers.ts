import * as R from 'ramda';
import type { Resolvers } from '../../../generated/graphql';
import { buildRefRelationKey, KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../../../schema/general';
import { RELATION_CREATED_BY, RELATION_OBJECT_ASSIGNEE } from '../../../schema/stixRefRelationship';
import { stixDomainObjectDelete } from '../../../domain/stixDomainObject';

import { addCaseRfi, caseRfiContainsStixObjectOrStixRelationship, findRfiPaginated, findById } from './case-rfi-domain';
import { ENTITY_TYPE_CONTAINER_CASE_RFI } from './case-rfi-types';
import { approveRequestAccess, declineRequestAccess, getRfiAccessConfiguration } from '../../requestAccess/requestAccess-domain';
import { internalLoadById } from '../../../database/middleware-loader';
import { BYPASS } from '../../../utils/access';
import { ForbiddenAccess } from '../../../config/errors';

// Needs to have edit rights or needs to be creator of the case RFI,
// and must share at least one organization with the case RFI's creator.
const checkUserAccess = async (context: any, user: any, id: string) => {
  const userCapabilities = R.flatten(user.capabilities.map((c: any) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const caseRfi = await findById(context, user, id);
  const isCreator = caseRfi[RELATION_CREATED_BY] ? caseRfi[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = caseRfi[RELATION_CREATED_BY];
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

const caseRfiResolvers: Resolvers = {
  Query: {
    caseRfi: (_, { id }, context) => findById(context, context.user, id),
    caseRfis: (_, args, context) => findRfiPaginated(context, context.user, args),
    caseRfiContainsStixObjectOrStixRelationship: (_, args, context) => {
      return caseRfiContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  CaseRfi: {
    requestAccessConfiguration: (caseRfi, _, context) => getRfiAccessConfiguration(context, context.user, caseRfi),
  },
  CaseRfisOrdering: {
    creator: 'creator_id',
    objectAssignee: buildRefRelationKey(RELATION_OBJECT_ASSIGNEE),
  },
  Mutation: {
    caseRfiAdd: (_, { input }, context) => {
      return addCaseRfi(context, context.user, input);
    },
    caseRfiDelete: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_CASE_RFI);
    },
    caseRfiApprove: (_, { id }, context) => {
      return approveRequestAccess(context, context.user, id);
    },
    caseRfiDecline: (_, { id }, context) => {
      return declineRequestAccess(context, context.user, id);
    },
  },
};

export default caseRfiResolvers;
