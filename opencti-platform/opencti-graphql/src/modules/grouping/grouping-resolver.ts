import * as R from 'ramda';
import type { Resolvers } from '../../generated/graphql';
import {
  addGrouping,
  findById,
  findGroupingPaginated,
  groupingContainsStixObjectOrStixRelationship,
  groupingsDistributionByEntity,
  groupingsNumber,
  groupingsNumberByAuthor,
  groupingsNumberByEntity,
  groupingsTimeSeries,
  groupingsTimeSeriesByAuthor,
  groupingsTimeSeriesByEntity,
} from './grouping-domain';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../../domain/stixDomainObject';
import { distributionEntities } from '../../database/middleware';
import { internalLoadById } from '../../database/middleware-loader';

import { ENTITY_TYPE_CONTAINER_GROUPING } from './grouping-types';
import { findSecurityCoverageByCoveredId } from '../securityCoverage/securityCoverage-domain';
import { RELATION_CREATED_BY } from '../../schema/stixRefRelationship';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../../schema/general';
import { BYPASS } from '../../utils/access';
import { ForbiddenAccess } from '../../config/errors';

// Needs to have edit rights or needs to be creator of the grouping,
// and must share at least one organization with the grouping's creator.
const checkUserAccess = async (context: any, user: any, id: string) => {
  const userCapabilities = R.flatten(user.capabilities.map((c: any) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const grouping = await findById(context, user, id);
  const isCreator = grouping[RELATION_CREATED_BY] ? grouping[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  // Enforce organization membership: non-bypass users must share at least
  // one organization with the grouping's creator to prevent cross-org modification.
  if (!isBypass && !isCreator) {
    const creatorId = grouping[RELATION_CREATED_BY];
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

const groupingResolvers: Resolvers = {
  Query: {
    grouping: (_, { id }, context) => findById(context, context.user, id),
    groupings: (_, args, context) => findGroupingPaginated(context, context.user, args),
    groupingsTimeSeries: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return groupingsTimeSeriesByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return groupingsTimeSeriesByAuthor(context, context.user, args);
      }
      return groupingsTimeSeries(context, context.user, args);
    },
    groupingsNumber: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return groupingsNumberByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return groupingsNumberByAuthor(context, context.user, args);
      }
      return groupingsNumber(context, context.user, args);
    },
    groupingsDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return groupingsDistributionByEntity(context, context.user, args);
      }
      return distributionEntities(context, context.user, [ENTITY_TYPE_CONTAINER_GROUPING], args);
    },
    groupingContainsStixObjectOrStixRelationship: (_, args, context) => {
      return groupingContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  Grouping: {
    securityCoverage: (grouping, _, context) => findSecurityCoverageByCoveredId(context, context.user, grouping.id),
  },
  Mutation: {
    groupingAdd: (_, { input }, context) => {
      return addGrouping(context, context.user, input);
    },
    groupingDelete: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_GROUPING);
    },
    groupingFieldPatch: async (_, { id, input, commitMessage, references }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectEditField(context, context.user, id, input, { commitMessage, references });
    },
    groupingContextPatch: async (_, { id, input }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectEditContext(context, context.user, id, input);
    },
    groupingContextClean: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectCleanContext(context, context.user, id);
    },
    groupingRelationAdd: async (_, { id, input }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectAddRelation(context, context.user, id, input);
    },
    groupingRelationDelete: async (_, { id, toId, relationship_type: relationshipType }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectDeleteRelation(context, context.user, id, toId, relationshipType);
    },
  },
};

export default groupingResolvers;
