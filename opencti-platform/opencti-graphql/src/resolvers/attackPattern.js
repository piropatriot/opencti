import * as R from 'ramda';
import {
  addAttackPattern,
  childAttackPatternsPaginated,
  coursesOfActionPaginated,
  dataComponentsPaginated,
  findAttackPatternPaginated,
  findById,
  getAttackPatternsMatrix,
  parentAttackPatternsPaginated,
} from '../domain/attackPattern';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDeleteRelation,
  stixDomainObjectDelete,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { ENTITY_TYPE_ATTACK_PATTERN } from '../schema/stixDomainObject';
import { loadThroughDenormalized } from './stix';
import { INPUT_KILLCHAIN, KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { internalLoadById } from '../database/middleware-loader';
import { BYPASS } from '../utils/access';
import { ForbiddenAccess } from '../config/errors';

// Needs to have edit rights or needs to be creator of the attack pattern,
// and must share at least one organization with the attack pattern's creator.
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isBypass = userCapabilities.includes(BYPASS);
  const isAuthorized = userCapabilities.includes(KNOWLEDGE_UPDATE);
  const attackPattern = await findById(context, user, id);
  const isCreator = attackPattern[RELATION_CREATED_BY] ? attackPattern[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isBypass || isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();

  if (!isBypass && !isCreator) {
    const creatorId = attackPattern[RELATION_CREATED_BY];
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

const attackPatternResolvers = {
  Query: {
    attackPattern: (_, { id }, context) => findById(context, context.user, id),
    attackPatterns: (_, args, context) => findAttackPatternPaginated(context, context.user, args),
    attackPatternsMatrix: (_, __, context) => getAttackPatternsMatrix(context, context.user),
  },
  AttackPattern: {
    killChainPhases: (attackPattern, _, context) => loadThroughDenormalized(context, context.user, attackPattern, INPUT_KILLCHAIN, { sortBy: 'phase_name' }),
    coursesOfAction: (attackPattern, args, context) => coursesOfActionPaginated(context, context.user, attackPattern.id, args),
    parentAttackPatterns: (attackPattern, args, context) => parentAttackPatternsPaginated(context, context.user, attackPattern.id, args),
    subAttackPatterns: (attackPattern, args, context) => childAttackPatternsPaginated(context, context.user, attackPattern.id, args),
    dataComponents: (attackPattern, args, context) => dataComponentsPaginated(context, context.user, attackPattern.id, args),
    isSubAttackPattern: (attackPattern, _, context) => context.batch.isSubAttachPatternBatchLoader.load(attackPattern.id),
  },
  Mutation: {
    attackPatternEdit: (_, { id }, context) => ({
      delete: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_ATTACK_PATTERN);
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
    attackPatternAdd: (_, { input }, context) => addAttackPattern(context, context.user, input),
  },
};

export default attackPatternResolvers;
