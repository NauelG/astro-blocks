/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export type PropType = 'string' | 'text' | 'number' | 'boolean' | 'image' | 'link' | 'select';

export interface PropDef {
  type: PropType;
  label: string;
  required?: boolean;
  options?: string[];
}

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

export interface Page {
  id: string;
  title: string;
  slug: string | string[];
  status: 'published' | 'draft' | 'archived';
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
  items: MenuItem[];
}

export interface MenusData {
  menus: Menu[];
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

export interface AstroBlocksOptions {
  layoutPath?: string;
  blocks: BlockSchema[];
  publicRendering?: 'server' | 'static';
  cache?: {
    enabled?: boolean;
    maxAge?: number;
    swr?: number;
  };
}
