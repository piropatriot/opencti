import * as R from 'ramda';
import type { Resolvers } from '../../../generated/graphql';
import { buildRefRelationKey, KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../../../schema/general';
import { RELATION_CREATED_BY, RELATION_OBJECT_ASSIGNEE } from '../../../schema/stixRefRelationship';
import { stixDomainObjectDelete } from '../../../domain/stixDomainObject';
import { addCaseIncident, caseIncidentContainsStixObjectOrStixRelationship, findCaseIncidentPaginated, findById } from './case-incident-domain';
import { ENTITY_TYPE_CONTAINER_CASE_INCIDENT } from './case-incident-types';
import { findSecurityCoverageByCoveredId } from '../../securityCoverage/securityCoverage-domain';
import { internalLoadById } from '../../../database/middleware-loader';
import { BYPASS } from '../../../utils/access';
import { ForbiddenAccess } from '../../../config/errors';

// Needs to have edit rights or needs to be creator of the case incident,
// and must share at least one organization with the case incident's creator.
const checkUserAccess = async (context: any, user: any, id: string) => {
  const userCapabilities = R.flatten(user.capabilities.map((c: any) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const caseIncident = await findById(context, user, id);
  const isCreator = caseIncident[RELATION_CREATED_BY] ? caseIncident[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = caseIncident[RELATION_CREATED_BY];
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

const caseIncidentResolvers: Resolvers = {
  Query: {
    caseIncident: (_, { id }, context) => findById(context, context.user, id),
    caseIncidents: (_, args, context) => findCaseIncidentPaginated(context, context.user, args),
    caseIncidentContainsStixObjectOrStixRelationship: (_, args, context) => {
      return caseIncidentContainsStixObjectOrStixRelationship(context, context.user, args.id, args.stixObjectOrStixRelationshipId);
    },
  },
  CaseIncident: {
    securityCoverage: (caseIncident, _, context) => findSecurityCoverageByCoveredId(context, context.user, caseIncident.id),
  },
  CaseIncidentsOrdering: {
    creator: 'creator_id',
    objectAssignee: buildRefRelationKey(RELATION_OBJECT_ASSIGNEE),
  },
  Mutation: {
    caseIncidentAdd: (_, { input }, context) => {
      return addCaseIncident(context, context.user, input);
    },
    caseIncidentDelete: async (_, { id }, context) => {
      await checkUserAccess(context, context.user, id);
      return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER_CASE_INCIDENT);
    },
  },
};

export default caseIncidentResolvers;
