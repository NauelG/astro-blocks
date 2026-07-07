/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export type PrimitivePropType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'image'
  | 'link'
  | 'select'
  | 'file';
export type PropType = PrimitivePropType | 'array';

export interface PrimitivePropDef {
  type: PrimitivePropType;
  label: string;
  required?: boolean;
  options?: string[];
  localizable?: boolean;
  /** For file props: allowed MIME types (subset of global allowedFileTypes). */
  accept?: string[];
  /** For file props: default download behavior — when true, fileDownloadUrl appends ?download. */
  download?: boolean;
}

export interface ObjectArrayItemDef {
  type: 'object';
  label: string;
  fields: Record<string, PrimitivePropDef>;
  summaryField?: string;
}

export type ArrayItemDef = PrimitivePropDef | ObjectArrayItemDef;

export interface ArrayPropDef {
  type: 'array';
  label: string;
  required?: boolean;
  localizable?: boolean;
  minItems?: number;
  maxItems?: number;
  sortable?: boolean;
  item: ArrayItemDef;
}

export type PropDef = PrimitivePropDef | ArrayPropDef;

export interface BlockDefinition {
  name: string;
  icon?: string;
  key?: string;
  items: Record<string, PropDef>;
}

export interface BlockSchema extends BlockDefinition {
  __componentPath?: string;
}

export interface SerializedSchema {
  name: string;
  icon?: string;
  items: Record<string, PropDef>;
}

export type SchemaMap = Record<string, SerializedSchema>;

export type LocalizedValueMap<T> = Record<string, T>;

export interface BlockInstance {
  type: string;
  props: Record<string, unknown>;
}

export interface SeoData {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  nofollow?: boolean;
}

export interface LocalizedSeoData {
  title?: LocalizedValueMap<string>;
  description?: LocalizedValueMap<string>;
  canonical?: LocalizedValueMap<string>;
  image?: LocalizedValueMap<string>;
  nofollow?: LocalizedValueMap<boolean>;
}

export type PageStatus = 'published' | 'draft' | 'archived';

export interface Page {
  id: string;
  title: LocalizedValueMap<string>;
  slug: LocalizedValueMap<string | string[]>;
  status: LocalizedValueMap<PageStatus>;
  indexable?: LocalizedValueMap<boolean>;
  seo?: LocalizedSeoData;
  blocks: BlockInstance[];
  publishedAt?: LocalizedValueMap<string | null>;
  createdAt?: string;
  updatedAt?: string;
}

export interface PageLocaleView {
  id: string;
  locale: string;
  title: string;
  slug: string | string[];
  status: PageStatus;
  indexable?: boolean;
  seo?: SeoData;
  blocks: BlockInstance[];
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PagesData {
  pages: Page[];
}

export interface Site {
  siteName: string;
  baseUrl: string;
  favicon: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  seo: {
    defaultTitle: string;
    defaultDescription: string;
  };
  i18n?: {
    routingStrategy?: PublicRoutingStrategy;
  };
  [key: string]: unknown;
}

export interface MenuItem {
  name: string;
  path: string;
  children?: MenuItem[];
}

export interface Menu {
  id: string;
  name: string;
  selector: string;
  items: LocalizedValueMap<MenuItem[]>;
}

export interface MenuLocaleView {
  id: string;
  locale: string;
  name: string;
  selector: string;
  items: MenuItem[];
}

export interface MenusData {
  menus: Menu[];
}

export type RedirectStatusCode = 301 | 302;

export interface RedirectRule {
  id: string;
  from: string;
  to: string;
  statusCode: RedirectStatusCode;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RedirectsData {
  redirects: RedirectRule[];
}

export interface ConfigEntry {
  id: string;
  key: string;
  value: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConfigsData {
  configs: ConfigEntry[];
}

export interface ContentLanguage {
  code: string;
  label: string;
  enabled: boolean;
  isDefault?: boolean;
}

export interface LanguagesData {
  languages: ContentLanguage[];
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'owner' | 'user';
  createdAt?: string;
}

export interface UsersData {
  users: User[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthResult {
  user: AuthUser;
}

export type PublicRoutingStrategy = 'path-prefix' | 'subdomain' | 'domain';

export interface GlobalBlockDeclaration {
  slug: string;
  schema: BlockSchema;
  label?: string;
}

export interface GlobalBlockEntry {
  props: Record<string, unknown>;
  updatedAt?: string;
}

export interface GlobalBlocksData {
  globalBlocks: Record<string, GlobalBlockEntry>;
}

export interface GlobalBlockRuntimeEntry {
  slug: string;
  schemaName: string;
  componentPath: string;
  label?: string;
}

/**
 * Represents the value stored for an image-type block prop.
 * The `url` is the only required field; `alt`, `width`, and `height` are optional.
 * Legacy string values are coerced to `{ url: string, alt: '' }` via `toImageValue()`.
 */
export interface ImageFieldValue {
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

/**
 * Represents the value stored for a file-type block prop.
 * The `url` is the only required field; all other fields are optional.
 * Mirrors ImageFieldValue — same hidden-input JSON pattern, different semantics.
 */
export interface FileFieldValue {
  url: string;
  filename?: string;
  mimeType?: string;
  /** When true, fileDownloadUrl appends ?download to trigger Content-Disposition: attachment. */
  download?: boolean;
}

export interface MediaVariant {
  format: 'webp' | 'avif';
  width: number;
  url: string;
}

export interface MediaEntry {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
  /** Default alt text for this asset. Editable on /cms/media inline. */
  alt?: string;
  /** Pixel width captured at upload time via image-size. */
  width?: number;
  /** Pixel height captured at upload time via image-size. */
  height?: number;
  /** Responsive image variants generated by sharp after upload. */
  variants?: MediaVariant[];
  /** Processing status of variant generation. */
  status?: 'processing' | 'ready' | 'failed';
  /**
   * Discriminator for the media entry type.
   * 'image' → mimeType starts with 'image/'.
   * 'document' → all other file types (e.g. PDF).
   * Derived from mimeType on load when absent (backward compat).
   */
  fileCategory?: 'image' | 'document';
}

export interface MediaData {
  uploads: MediaEntry[];
}

// --- Import/Export types ---

export type ExportUnit = 'pages' | 'media' | 'users' | 'configuration' | 'global-blocks';

export interface BackupManifest {
  /** DATA_SCHEMA_VERSION at export time. Strict equality checked on import. */
  schemaVersion: number;
  /** Package version from package.json — informational only, does not gate import. */
  astroBlocksVersion: string;
  /** ISO 8601 timestamp of when the archive was created. */
  exportedAt: string;
  /** The export units included in this archive. */
  units: ExportUnit[];
  /** Entry count per unit. */
  counts: Partial<Record<ExportUnit, number>>;
  /** Zip-entry path → sha256 hex digest for every data/* and uploads/* entry. */
  checksums: Record<string, string>;
}

// --- End Import/Export types ---

export interface AstroBlocksOptions {
  layoutPath?: string;
  blocks: BlockSchema[];
  globalBlocks?: GlobalBlockDeclaration[];
  publicRendering?: 'server' | 'static';
  cache?: {
    enabled?: boolean;
    maxAge?: number;
    swr?: number;
  };
  i18n?: {
    routingStrategy?: PublicRoutingStrategy;
  };
  /**
   * Global allowlist of MIME types accepted by the media upload endpoint.
   * Defaults to DEFAULT_ALLOWED_FILE_TYPES when not provided.
   * Values are lowercased and deduplicated by resolveOptions.
   */
  allowedFileTypes?: string[];
}
