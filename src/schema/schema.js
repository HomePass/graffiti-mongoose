import {reduce} from 'lodash';
import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLID,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLScalarType,
  GraphQLBoolean
} from 'graphql';
import {
  mutationWithClientMutationId,
  connectionArgs,
  connectionDefinitions
} from 'graphql-relay';
import {getModels} from './../model';
import {getTypes, nodeInterface} from './../type';
import {
  getIdFetcher,
  getOneResolver,
  getListResolver,
  getAddOneMutateHandler,
  getUpdateOneMutateHandler,
  getDeleteOneMutateHandler,
  connectionFromModel
} from './../query';

function getSingularQueryField(graffitiModel, type) {
  const {name} = type;
  const singularName = name.toLowerCase();

  return {
    [singularName]: {
      type: type,
      args: {
        id: {
          type: new GraphQLNonNull(GraphQLID),
          description: `The ID of a ${name}`
        }
      },
      resolve: getOneResolver(graffitiModel)
    }
  };
}

function getPluralQueryField(graffitiModel, type) {
  const {name} = type;
  const pluralName = `${name.toLowerCase()}s`;

  return {
    [pluralName]: {
      type: new GraphQLList(type),
      args: reduce(type._typeConfig.fields(), (args, field) => {
        if (field.type instanceof GraphQLNonNull && field.name !== 'id') {
          field.type = field.type.ofType;
        }

        if (field.type instanceof GraphQLScalarType) {
          args[field.name] = field;
        }

        return args;
      }, {
        id: {
          type: new GraphQLList(GraphQLID),
          description: `The ID of a ${name}`
        },
        ids: {
          type: new GraphQLList(GraphQLID),
          description: `The ID of a ${name}`
        }
      }),
      resolve: getListResolver(graffitiModel)
    }
  };
}

function getQueryField(graffitiModel, type) {
  return {
    ...getSingularQueryField(graffitiModel, type),
    ...getPluralQueryField(graffitiModel, type)
  };
}

function getConnectionField(graffitiModel, type) {
  const {name} = type;
  const pluralName = `${name.toLowerCase()}s`;
  const {connectionType} = connectionDefinitions({name: name, nodeType: type});

  return {
    [pluralName]: {
      args: connectionArgs,
      type: connectionType,
      resolve: (rootValue, args, info) => connectionFromModel(graffitiModel, args, info)
    }
  };
}

function getMutationField(graffitiModel, type) {
  const {name} = type;

  const allFields = type._typeConfig.fields();
  const args = reduce(allFields, (args, field) => {
    if (field.type instanceof GraphQLObjectType) {
      if (field.type.name.endsWith('Connection')) {
        args[field.name] = {
          name: field.name,
          type: new GraphQLList(GraphQLID)
        };
      }
      // TODO support objects
      // else {
      //   args = {...args, ...field.type._typeConfig.fields()};
      // }
    }
    if (!(field.type instanceof GraphQLObjectType) && field.name !== 'id' && !field.name.startsWith('_')) {
      args[field.name] = field;
    }
    return args;
  }, {});

  const addName = `add${name}`;
  const updateName = `update${name}`;
  const deleteName = `delete${name}`;

  return {
    [addName]: mutationWithClientMutationId({
      name: addName,
      inputFields: args,
      outputFields: allFields,
      mutateAndGetPayload: getAddOneMutateHandler(graffitiModel)
    }),
    [updateName]: mutationWithClientMutationId({
      name: updateName,
      inputFields: {
        ...args,
        id: {
          type: new GraphQLNonNull(GraphQLID),
          description: `The ID of a ${name}`
        }
      },
      outputFields: allFields,
      mutateAndGetPayload: getUpdateOneMutateHandler(graffitiModel)
    }),
    [deleteName]: mutationWithClientMutationId({
      name: deleteName,
      inputFields: {
        id: {
          type: new GraphQLNonNull(GraphQLID),
          description: `The ID of a ${name}`
        }
      },
      outputFields: {
        ok: {type: GraphQLBoolean}
      },
      mutateAndGetPayload: getDeleteOneMutateHandler(graffitiModel)
    })
  };
}

function getFields(graffitiModels, {mutation} = {mutation: true}) {
  const types = getTypes(graffitiModels);

  const {queries, mutations} = reduce(types, ({queries, mutations}, type, key) => {
    type.name = type.name || key;
    const graffitiModel = graffitiModels[type.name];
    return {
      queries: {
        ...queries,
        ...getQueryField(graffitiModel, type)
      },
      mutations: {
        ...mutations,
        ...getMutationField(graffitiModel, type)
      }
    };
  }, {
    queries: {},
    mutations: {}
  });

  const RootQuery = new GraphQLObjectType({
    name: 'RootQuery',
    fields: {
      viewer: {
        name: 'viewer',
        type: new GraphQLObjectType({
          name: 'Viewer',
          fields: reduce(types, (fields, type, key) => {
            type.name = type.name || key;
            const graffitiModel = graffitiModels[type.name];
            return {
              ...fields,
              ...getConnectionField(graffitiModel, type),
              ...getSingularQueryField(graffitiModel, type)
            };
          }, {})
        }),
        resolve: () => ({})
      },
      node: {
        name: 'node',
        description: 'Fetches an object given its ID',
        type: nodeInterface,
        args: {
          id: {
            type: new GraphQLNonNull(GraphQLID),
            description: 'The ID of an object'
          }
        },
        resolve: getIdFetcher(graffitiModels)
      },
      ...queries
    }
  });

  const RootMutation = new GraphQLObjectType({
    name: 'RootMutation',
    fields: mutations
  });

  const fields = {
    query: RootQuery
  };

  if (mutation) {
    fields.mutation = RootMutation;
  }

  return fields;
}

function getSchema(mongooseModels, options) {
  const graffitiModels = getModels(mongooseModels);
  const fields = getFields(graffitiModels, options);
  return new GraphQLSchema(fields);
}

export default {
  getQueryField,
  getMutationField,
  getFields,
  getSchema
};
