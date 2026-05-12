import * as R from 'ramda';
import {
  addReport,
  findById,
  findReportPaginated,
  reportContainsStixObjectOrStixRelationship,
  reportDeleteElementsCount,
  reportDeleteWithElements,
  reportsDistributionByEntity,
  reportsNumber,
  reportsNumberByAuthor,
  reportsNumberByEntity,
  reportsTimeSeries,
  reportsTimeSeriesByAuthor,
  reportsTimeSeriesByEntity,
} from '../domain/report';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { distributionEntities } from '../database/middleware';
import { ENTITY_TYPE_CONTAINER_REPORT } from '../schema/stixDomainObject';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { BYPASS, isUserHasCapability, KNOWLEDGE_KNUPDATE } from '../utils/access';
import { ForbiddenAccess } from '../config/errors';
import { internalLoadById } from '../database/middleware-loader';
import { findSecurityCoverageByCoveredId } from '../modules/securityCoverage/securityCoverage-domain';
import { loadParticipants } from '../database/members';

// Needs to have edit rights or needs to be creator of the report,
// and must share at least one organization with the report's creator.
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const report = await findById(context, user, id);
  const isCreator = report[RELATION_CREATED_BY] ? report[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  // Enforce organization membership: non-bypass users must share at least
  // one organization with the report's creator to prevent cross-org modification.
  if (!isBypass && !isCreator) {
    const creatorId = report[RELATION_CREATED_BY];
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

const reportResolvers = {
  Query: {
    report: (_, { id }, context) => findById(context, context.user, id),
    reports: (_, args, context) => findReportPaginated(context, context.user, args),
    reportsTimeSeries: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return reportsTimeSeriesByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return reportsTimeSeriesByAuthor(context, context.user, args);
      }
      return reportsTimeSeries(context, context.user, args);
    },
    reportsNumber: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return reportsNumberByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return reportsNumberByAuthor(context, context.user, args);
      }
      return reportsNumber(context, context.user, args);
    },
    reportsDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return reportsDistributionByEntity(context, context.user, args);
      }
      return distributionEntities(context, context.user, [ENTITY_TYPE_CONTAINER_REPORT], args);
    },
    reportContainsStixObjectOrStixRelationship: (_, args, context) => {
      return reportContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  Report: {
    deleteWithElementsCount: (report, _, context) => reportDeleteElementsCount(context, context.user, report.id),
    objectParticipant: async (container, _, context) => loadParticipants(context, context.user, container),
    securityCoverage: (report, _, context) => findSecurityCoverageByCoveredId(context, context.user, report.id),
  },
  Mutation: {
    reportEdit: (_, { id }, context) => ({
      delete: async ({ purgeElements }) => {
        await checkUserAccess(context, context.user, id);
        if (purgeElements) {
          return reportDeleteWithElements(context, context.user, id);
        }
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_REPORT);
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
      relationAdd: async ({ input, commitMessage, references }) => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectAddRelation(context, context.user, id, input, { commitMessage, references });
      },
      // eslint-disable-next-line max-len
      relationDelete: async ({ toId, relationship_type: relationshipType, commitMessage, references }) => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDeleteRelation(context, context.user, id, toId, relationshipType, { commitMessage, references });
      },
    }),
    reportAdd: (_, { input }, context) => addReport(context, context.user, input),
  },
};

export default reportResolvers;
