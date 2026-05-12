import * as R from 'ramda';
import type { Resolvers } from '../../../generated/graphql';
import { buildRefRelationKey, KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../../../schema/general';
import { RELATION_CREATED_BY, RELATION_OBJECT_ASSIGNEE } from '../../../schema/stixRefRelationship';
import { stixDomainObjectDelete } from '../../../domain/stixDomainObject';

import { addCaseRft, caseRftContainsStixObjectOrStixRelationship, findRftPaginated, findById } from './case-rft-domain';
import { ENTITY_TYPE_CONTAINER_CASE_RFT } from './case-rft-types';
import { internalLoadById } from '../../../database/middleware-loader';
import { BYPASS } from '../../../utils/access';
import { ForbiddenAccess } from '../../../config/errors';

// Needs to have edit rights or needs to be creator of the case RFT,
// and must share at least one organization with the case RFT's creator.
const checkUserAccess = async (context: any, user: any, id: string) => {
  const userCapabilities = R.flatten(user.capabilities.map((c: any) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const caseRft = await findById(context, user, id);
  const isCreator = caseRft[RELATION_CREATED_BY] ? caseRft[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = caseRft[RELATION_CREATED_BY];
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

const caseRftResolvers: Resolvers = {
  Query: {
    caseRft: (_, { id }, context) => findById(context, context.user, id),
    caseRfts: (_, args, context) => findRftPaginated(context, context.user, args),
    caseRftContainsStixObjectOrStixRelationship: (_, args, context) => {
      return caseRftContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  CaseRftsOrdering: {
    creator: 'creator_id',
    objectAssignee: buildRefRelationKey(RELATION_OBJECT_ASSIGNEE),
  },
  Mutation: {
    caseRftAdd: (_, { input }, context) => {
      return addCaseRft(context, context.user, input);
    },
    caseRftDelete: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_CASE_RFT);
    },
  },
};

export default caseRftResolvers;
