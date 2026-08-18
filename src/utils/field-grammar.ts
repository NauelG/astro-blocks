/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Grammars for stored fields, shared by the HTTP handlers and the import
 * validators so no entry door can drift from another (#108). Callers pass the
 * already-normalized value (post trim/lowercase); these predicates state
 * grammar only — they never trim, lowercase, or localize.
 */

// The WHATWG HTML5 <input type="email"> grammar — what the admin form's own
// browser validation accepts, so server and client agree by construction.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const EMAIL_MAX_LENGTH = 254;

// C0 controls, DEL, and C1 controls — none belong in a one-line name.
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/;

const LABEL_MAX_LENGTH = 80;

export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email);
}

export function isValidLanguageLabel(label: string): boolean {
  return (
    label.trim().length > 0 && label.length <= LABEL_MAX_LENGTH && !CONTROL_CHARS_RE.test(label)
  );
}

export function isValidLanguageCode(code: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code);
}
