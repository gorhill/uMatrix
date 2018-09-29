/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2018-present Raymond Hill

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

/* exported uMatrixScopeWidget */
/* global punycode */

'use strict';

/******************************************************************************/
/******************************************************************************/

let uMatrixScopeWidget = (function() {

// Start of private namespace
// >>>>>>>>

/******************************************************************************/

let currentScope = '';
let listening = false;

let fireChangeEvent = function() {
    document.body.setAttribute('data-scope', currentScope);
    let ev = new CustomEvent(
        'uMatrixScopeWidgetChange',
        {
            detail: { scope: currentScope }
        }
    );
    window.dispatchEvent(ev);
};

let init = function(domain, hostname, scope, container) {
    if ( typeof domain !== 'string' ) { return; }

    currentScope = '';

    // Reset widget
    if ( !container ) {
        container = document;
    }
    let specificScope = container.querySelector('#specificScope');
    while ( specificScope.firstChild !== null ) {
        specificScope.removeChild(specificScope.firstChild);
    }

    // Fill in the scope menu entries
    let pos = domain.indexOf('.');
    let tld, labels;
    if ( pos === -1 ) {
        tld = '';
        labels = hostname;
    } else {
        tld = domain.slice(pos + 1);
        labels = hostname.slice(0, -tld.length);
    }
    let beg = 0;
    while ( beg < labels.length ) {
        pos = labels.indexOf('.', beg);
        if ( pos === -1 ) {
            pos = labels.length;
        } else {
            pos += 1;
        }
        let label = document.createElement('span');
        label.appendChild(
            document.createTextNode(punycode.toUnicode(labels.slice(beg, pos)))
        );
        let span = document.createElement('span');
        span.setAttribute('data-scope', labels.slice(beg) + tld);
        span.appendChild(label);
        specificScope.appendChild(span);
        beg = pos;
    }
    if ( tld !== '' ) {
        let label = document.createElement('span');
        label.appendChild(document.createTextNode(punycode.toUnicode(tld)));
        let span = document.createElement('span');
        span.setAttribute('data-scope', tld);
        span.appendChild(label);
        specificScope.appendChild(span);
    }

    if ( listening === false ) {
        container.querySelector('#specificScope').addEventListener(
            'click',
            ev => { update(ev.target.getAttribute('data-scope')); }
        );
        container.querySelector('#globalScope').addEventListener(
            'click',
            ( ) => { update('*'); }
        );
        listening = true;
    }

    update(scope || hostname, container);
};

let getScope = function() {
    return currentScope;
};

let update = function(scope, container) {
    if ( scope === currentScope ) { return; }
    currentScope = scope;
    if ( !container ) {
        container = document;
    }
    let specificScope = container.querySelector('#specificScope'),
        isGlobal = scope === '*';
    specificScope.classList.toggle('on', !isGlobal);
    container.querySelector('#globalScope').classList.toggle('on', isGlobal);
    for ( let node of specificScope.children ) {
        node.classList.toggle(
            'on', 
            !isGlobal &&
                scope.endsWith(node.getAttribute('data-scope'))
        );
    }
    fireChangeEvent();
};

return { init, getScope, update };

/******************************************************************************/

// <<<<<<<<
// End of private namespace

})();

/******************************************************************************/
/******************************************************************************/

