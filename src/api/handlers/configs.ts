/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ConfigEntry } from '../../types/index.js';
import * as data from '../data.js';
import { jsonError, localizedJsonError, parseJsonBody } from './shared.js';
import type { HandlerContext } from './shared.js';
import { invalidateGlobalContentCache } from './cache-invalidation.js';

const CONFIG_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_.-]*$/;

function normalizeConfigKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function configKeyIdentity(key: string): string {
  return key.trim().toLowerCase();
}

function hasDuplicateConfigKey(configs: ConfigEntry[], key: string, excludeId?: string): boolean {
  const target = configKeyIdentity(key);
  if (!target) return false;
  return configs.some((entry) => {
    if (excludeId && entry.id === excludeId) return false;
    return configKeyIdentity(entry.key) === target;
  });
}

function normalizeConfigPayload(
  body: Record<string, unknown>,
  current?: ConfigEntry,
): ConfigEntry | { errorKey: string } {
  const key = normalizeConfigKey(body.key !== undefined ? body.key : current?.key);
  if (!key) return { errorKey: 'errors.configKeyRequired' };
  if (!CONFIG_KEY_REGEX.test(key)) {
    return { errorKey: 'errors.invalidConfigKey' };
  }

  const valueInput = body.value !== undefined ? body.value : current?.value;
  const value =
    typeof valueInput === 'string'
      ? valueInput
      : valueInput === undefined || valueInput === null
        ? ''
        : String(valueInput);
  const descriptionInput = body.description !== undefined ? body.description : current?.description;
  const description = typeof descriptionInput === 'string' ? descriptionInput.trim() : '';

  return {
    id: current?.id || '',
    key,
    value,
    ...(description ? { description } : {}),
    createdAt: current?.createdAt,
    updatedAt: current?.updatedAt,
  };
}

export async function handleGetConfigs(): Promise<Response> {
  const configsData = await data.loadConfigs();
  return Response.json(configsData);
}

export async function handlePostConfigs(
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const configsData = await data.loadConfigs();
  const parsed = normalizeConfigPayload(body);
  if ('errorKey' in parsed) return localizedJsonError(request, parsed.errorKey);

  if (hasDuplicateConfigKey(configsData.configs, parsed.key)) {
    return localizedJsonError(request, 'errors.configKeyExists');
  }

  const now = new Date().toISOString();
  const entry: ConfigEntry = {
    ...parsed,
    id: data.generateId(),
    createdAt: now,
    updatedAt: now,
  };

  configsData.configs.push(entry);
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(entry);
}

export async function handlePutConfig(
  id: string,
  request: Request,
  context: HandlerContext = {},
): Promise<Response> {
  const { data: body, error } = await parseJsonBody<Record<string, unknown>>(request);
  if (error || !body) return error as Response;

  const configsData = await data.loadConfigs();
  const index = configsData.configs.findIndex((entry) => entry.id === id);
  if (index === -1) return localizedJsonError(request, 'errors.notFound', 404);

  const current = configsData.configs[index];
  const parsed = normalizeConfigPayload(body, current);
  if ('errorKey' in parsed) return localizedJsonError(request, parsed.errorKey);

  if (hasDuplicateConfigKey(configsData.configs, parsed.key, id)) {
    return localizedJsonError(request, 'errors.configKeyExists');
  }

  const updated: ConfigEntry = {
    ...current,
    ...parsed,
    id: current.id,
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  configsData.configs[index] = updated;
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return Response.json(updated);
}

export async function handleDeleteConfig(
  id: string,
  context: HandlerContext = {},
  request?: Request,
): Promise<Response> {
  const configsData = await data.loadConfigs();
  const index = configsData.configs.findIndex((entry) => entry.id === id);
  if (index === -1)
    return request
      ? localizedJsonError(request, 'errors.notFound', 404)
      : jsonError('Not found', 404);

  configsData.configs.splice(index, 1);
  await data.saveConfigs(configsData);
  await invalidateGlobalContentCache(context.cache);
  return new Response(null, { status: 204 });
}
