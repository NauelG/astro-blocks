/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export type PrimitivePropType = 'string' | 'text' | 'number' | 'boolean' | 'image' | 'link' | 'select';
export type PropType = PrimitivePropType | 'array';

export interface PrimitivePropDef {
  type: PrimitivePropType;
  label: string;
  required?: boolean;
  options?: string[];
  localizable?: boolean;
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

export interface AstroBlocksOptions {
  layoutPath?: string;
  blocks: BlockSchema[];
  publicRendering?: 'server' | 'static';
  cache?: {
    enabled?: boolean;
    maxAge?: number;
    swr?: number;
  };
  i18n?: {
    routingStrategy?: PublicRoutingStrategy;
  };
}
