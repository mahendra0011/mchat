import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DependencyRegister } from './register.js';

test('categorizes dependencies by name', () => {
  const reg = new DependencyRegister();
  assert.equal(reg.categorizeDependency('pg'), 'database');
  assert.equal(reg.categorizeDependency('redis'), 'cache');
  assert.equal(reg.categorizeDependency('jest'), 'testing');
});

test('registers a dependency entry', () => {
  const reg = new DependencyRegister();
  const entry = reg.registerDependency('fastify', '4.28.1', 'MIT', 'api', 'low', 'https://fastify.dev', 'https://github.com/fastify/fastify', '2026-01-01');
  assert.equal(entry.name, 'fastify');
  assert.equal(entry.category, 'api');
  assert.equal(reg.get('fastify')?.version, '4.28.1');
});

test('checks semver compatibility', () => {
  const reg = new DependencyRegister();
  reg.registerDependency('react', '18.2.0', 'MIT', 'ui', 'low');
  assert.equal(reg.checkCompatibility('react', '18.3.0'), true);
  assert.equal(reg.checkCompatibility('react', '19.0.0'), false);
  assert.equal(reg.checkCompatibility('unknown', 'not-a-version'), false);
});
