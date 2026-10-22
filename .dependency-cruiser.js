/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-not-to-infrastructure',
      comment: 'Domain layer cannot depend on infrastructure',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/domain/',
      },
      to: {
        path: 'infrastructure',
      },
    },
    {
      name: 'domain-not-to-external-tech',
      comment:
        'Domain layer cannot depend on @nestjs/*, pg, bullmq, or ioredis',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/domain/',
      },
      to: {
        path: '^(@nestjs/|pg|bullmq|ioredis)',
      },
    },
    {
      name: 'application-not-to-infrastructure',
      comment: 'Application layer cannot depend on infrastructure',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/application/',
      },
      to: {
        path: 'infrastructure',
      },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependency detected',
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
  },
};
