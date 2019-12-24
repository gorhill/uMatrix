/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2018 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

'use strict';

// The idea of using <meta http-equiv> to enforce CSP directive has been
// borrowed from NoScript:
// https://github.com/hackademix/noscript/commit/6e80d3f130773fc9a9123c5c4c2e97d63e90fa2a

(( ) => {
    const html = document.documentElement;
    if ( html instanceof HTMLElement === false ) { return; }

    let meta;
    try {
        meta = document.createElement('meta');
    } catch(ex) {
    }
    if ( meta === undefined ) { return; }
    meta.setAttribute('http-equiv', 'content-security-policy');
    meta.setAttribute('content', "worker-src 'none'");

    // https://html.spec.whatwg.org/multipage/semantics.html#attr-meta-http-equiv-content-security-policy
    //
    // Only a head element can be parent:
    // > If the meta element is not a child of a head element, return.
    //
    // The CSP directive is enforced as soon as the meta tag is inserted:
    // > Enforce the policy policy.
    const head = document.head;
    let parent = head;
    if ( parent === null ) {
        parent = document.createElement('head');
        html.appendChild(parent);
    }
    parent.appendChild(meta);

    // Restore DOM to its original state.
    if ( head === null ) {
        html.removeChild(parent);
    } else {
        parent.removeChild(meta);
    }
})();
