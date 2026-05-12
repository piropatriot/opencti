import * as R from 'ramda';
import {
  containersObjectsOfObject,
  findContainerPaginated,
  findById,
  knowledgeAddFromInvestigation,
  objects,
  relatedContainers,
  containersNumber,
  containersNumberByAuthor,
  containersNumberByEntity,
  containerEditAuthorizedMembers,
  aiSummary,
  containersDistributionByEntity,
} from '../domain/container';
import {
  stixDomainObjectAddRelation,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
} from '../domain/stixDomainObject';
import { investigationAddFromContainer } from '../modules/workspace/investigation-domain';
import { getAuthorizedMembers } from '../utils/authorizedMembers';
import { BYPASS, getUserAccessRight, isUserHasCapability, KNOWLEDGE_KNUPDATE } from '../utils/access';
import { distributionEntities } from '../database/middleware';
import { ENTITY_TYPE_CONTAINER, KNOWLEDGE_COLLABORATION, KNOWLEDGE_UPDATE } from '../schema/general';
import { RELATION_CREATED_BY } from '../schema/stixRefRelationship';
import { ForbiddenAccess } from '../config/errors';

// Needs to have edit rights or needs to be creator of the container
const checkUserAccess = async (context, user, id) => {
  const userCapabilities = R.flatten(user.capabilities.map((c) => c.name.split('_')));
  const isAuthorized = userCapabilities.includes(BYPASS) || userCapabilities.includes(KNOWLEDGE_UPDATE);
  const container = await findById(context, user, id);
  const isCreator = container[RELATION_CREATED_BY] ? container[RELATION_CREATED_BY] === user.individual_id : false;
  const isCollaborationAllowed = userCapabilities.includes(KNOWLEDGE_COLLABORATION) && isCreator;
  const accessGranted = isAuthorized || isCollaborationAllowed;
  if (!accessGranted) throw ForbiddenAccess();
};

const containerResolvers = {
  Query: {
    container: (_, { id }, context) => findById(context, context.user, id),
    containers: (_, args, context) => findContainerPaginated(context, context.user, args),
    containersObjectsOfObject: (_, args, context) => containersObjectsOfObject(context, context.user, args),
    containersNumber: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return containersNumberByEntity(context, context.user, args);
      }
      if (args.authorId && args.authorId.length > 0) {
        return containersNumberByAuthor(context, context.user, args);
      }
      return containersNumber(context, context.user, args);
    },
    containersDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return containersDistributionByEntity(context, context.user, args);
      }
      return distributionEntities(context, context.user, [ENTITY_TYPE_CONTAINER], args);
    },
    containersAskAiSummary: (_, args, context) => aiSummary(context, context.user, args),
  },
  Container: {
    __resolveType(obj) {
      if (obj.entity_type) {
        return obj.entity_type.replace(/(?:^|-)(\w)/g, (matches, letter) => letter.toUpperCase());
      }
      return 'Unknown';
    },
    authorized_members: (container, _, context) => getAuthorizedMembers(context, context.user, container),
    currentUserAccessRight: (container, _, context) => getUserAccessRight(context.user, container),
    objects: (container, args, context) => objects(context, context.user, container.id, args),
    relatedContainers: (container, args, context) => relatedContainers(context, context.user, container.id, args),
  },
  // TODO Reactivate after official release of graphQL 17
  // StixObjectOrStixRelationshipRefConnection: {
  //   edges: async function* generateEdges(connection) {
  //     const t0 = new Date().getTime();
  //     const elements = connection.edges;
  //     // eslint-disable-next-line no-restricted-syntax
  //     for (const [idx, item] of elements.entries()) {
  //       // Check every Nth item (e.g. 20th) if the elapsed time is larger than 50 ms.
  //       // If so, break and divide work into chunks using setImmediate
  //       if (idx % 20 === 0 && idx > 0 && new Date().getTime() - t0 > 50) { // 20 MS of locking
  //         await new Promise((resolve) => {
  //           setImmediate(resolve);
  //         });
  //       }
  //       yield item;
  //     }
  //   }
  // },
  Mutation: {
    containerEdit: (_, { id }, context) => ({
      delete: async () => {
        await checkUserAccess(context, context.user, id);
        return stixDomainObjectDelete(context, context.user, id, ENTITY_TYPE_CONTAINER);
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
      editAuthorizedMembers: async ({ input }) => {
        await checkUserAccess(context, context.user, id);
        return containerEditAuthorizedMembers(context, context.user, id, input);
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
      investigationAdd: () => investigationAddFromContainer(context, context.user, id),
      knowledgeAddFromInvestigation: ({ workspaceId }) => knowledgeAddFromInvestigation(context, context.user, { containerId: id, workspaceId }),
    }),
  },
};

export default containerResolvers;
