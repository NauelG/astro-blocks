/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export { localizedJsonError } from './handlers/shared.js';
export { handleGetSite, handlePutSite } from './handlers/site.js';
export {
  classifyJwtSecret,
  getAuth,
  hashPassword,
  requireOwner,
  verifyPassword,
} from './handlers/auth-core.js';
export type { JwtSecretStatus } from './handlers/auth-core.js';
export { handleLogin, handleAuthMe, handleAuthStatus } from './handlers/auth.js';
export {
  handleGetUsers,
  handlePostUsers,
  handlePutUser,
  handleDeleteUser,
} from './handlers/users.js';
export {
  handleGetLanguages,
  handlePostLanguages,
  handlePutLanguage,
  handleDeleteLanguage,
} from './handlers/languages.js';
export {
  handleGetPages,
  handleGetBlockSchemas,
  handlePostPages,
  handlePutPage,
  handleDeletePage,
} from './handlers/pages.js';
export {
  handleGetGlobalBlocks,
  handleGetGlobalBlock,
  handlePutGlobalBlock,
} from './handlers/global-blocks.js';
export {
  resetAllowedFileTypesCache,
  __setAllowedFileTypesForTest,
  handleUpload,
  handleDeleteUpload,
  handleGetMedia,
  handleUpdateMediaAlt,
  handleGetMediaUsage,
  handleReplaceUpload,
} from './handlers/media.js';
export {
  handleGetMenus,
  handlePostMenus,
  handlePutMenu,
  handleDeleteMenu,
} from './handlers/menus.js';
export {
  handleGetRedirects,
  handlePostRedirects,
  handlePutRedirect,
  handleDeleteRedirect,
} from './handlers/redirects.js';
export {
  handleGetConfigs,
  handlePostConfigs,
  handlePutConfig,
  handleDeleteConfig,
} from './handlers/configs.js';
export { handleInvalidateCache } from './handlers/cache.js';
export { handleExport, handleImport, handleBootstrapImport } from './handlers/backup-routes.js';
