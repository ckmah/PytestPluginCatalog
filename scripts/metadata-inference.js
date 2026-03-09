'use strict';

const CAT_RULES = [
  [['asyncio', 'trio', 'anyio', 'tornado', 'twisted', ' aiohttp'], 'async'],
  [['playwright', 'selenium', ' bdd ', 'e2e', 'browser test'], 'browser'],
  [['coverage', 'pytest-cov', 'memray', 'pointers'], 'coverage'],
  [['postgresql', 'redis', 'mysql', 'docker', 'celery', 'testinfra', 'alembic', 'xprocess', 'ansible'], 'databases'],
  [['sugar', 'clarity', 'pretty', 'progressbar', 'instafail', 'icdiff', 'structlog', 'loguru', 'logger', 'describe'], 'devex'],
  [['xdist', 'parallel', 'distributed', 'timeout', 'repeat', 'retry', 'rerun', 'ordering', 'order', 'testmon', 'watcher', 'split', 'randomly', 'skip-slow', 'dependency', 'depends', 'custom-exit-code', 'flakefinder', 'picked', 'incremental', 'tagging', 'test-groups', 'find-dependencies', 'filter-subpackage', 'random-order'], 'execution'],
  [['snapshot', 'syrupy', 'inline-snapshot', 'regression', 'factory', 'parametrization', 'lazy fixture', 'assume', 'check', 'subtests', 'deadfixtures', 'env', 'dotenv', 'variables', 'unordered', 'arraydiff', 'mpl', 'cases'], 'fixtures'],
  [['mock', 'pyfakefs', 'fake file', 'vcr', 'httpx', 'httpserver', 'socket', 'freezegun', 'freezer', 'responses', 'recording', 'subprocess', 'mock-resources'], 'mocking'],
  [['benchmark', 'codspeed', 'durations', 'profiling', 'harvest', 'monitor'], 'performance'],
  [['mypy', 'ruff', 'black', 'pylint', 'flake8', 'pep8', 'hypothesis', 'doctest', 'astropy', 'markdown-docs'], 'quality'],
  [['html report', 'json report', 'allure', 'reportportal', 'metadata', 'opentelemetry', 'nunit', 'csv', 'slack', 'md-report', 'github-actions-annotate', 'azurepipelines', 'reportlog', 'timestamper', 'astropy-header'], 'reporting'],
  [['django', 'flask'], 'web'],
  [['datadir', 'shutil', 'sftpserver', 'remotedata', 'localserver', 'console-scripts', 'examples', 'spark'], 'io'],
];

function inferCat(name, summary) {
  const text = `${name} ${summary}`.toLowerCase();
  for (const [keywords, cat] of CAT_RULES) {
    if (keywords.some((k) => text.includes(k))) return cat;
  }
  return 'other';
}

function inferOS(name, summary, legacyWin) {
  const text = `${name} ${summary}`.toLowerCase();
  let Mac = true;
  let Linux = true;
  let Windows = true;

  const windowsIncompatible = [
    'memray', 'pytest-timeouts', 'unix', 'posix', 'linux-only', 'linux only',
  ];
  const windowsMaybe = [
    'docker', 'testinfra', 'ansible', 'sftpserver', 'postgresql', 'redis', 'mysql',
    'xprocess', 'twisted', 'console-scripts', 'spark',
  ];

  if (legacyWin === false) Windows = false;
  else if (legacyWin === true) { /* all true */ }
  else {
    if (windowsIncompatible.some((k) => text.includes(k))) Windows = false;
    else if (windowsMaybe.some((k) => text.includes(k))) Windows = 'maybe';
  }
  if (windowsIncompatible.some((k) => text.includes(k))) Windows = false;

  return { Mac, Linux, Windows };
}

module.exports = { inferCat, inferOS };
