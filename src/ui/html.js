/*
 * ui/html.js — htm template tag bound to Preact.
 * Components are written as plain functions returning html`…` templates.
 */

'use strict';

import { h, Fragment } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
export { Fragment };
