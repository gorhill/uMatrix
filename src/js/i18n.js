/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* global vAPI, uDom */

/******************************************************************************/

// This file should always be included at the end of the `body` tag, so as
// to ensure all i18n targets are already loaded.

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2084
//   Anything else than <a>, <b>, <code>, <em>, <i>, <input>, and <span> will
//   be rendered as plain text.
//   For <input>, only the type attribute is allowed.
//   For <a>, only href attribute must be present, and it MUST starts with
//   `https://`, and includes no single- or double-quotes.
//   No HTML entities are allowed, there is code to handle existing HTML
//   entities already present in translation files until they are all gone.

var reSafeTags = /^([\s\S]*?)<(b|blockquote|code|em|i|span|sup)>(.+?)<\/\2>([\s\S]*)$/,
    reSafeInput = /^([\s\S]*?)<(input type="[^"]+")>(.*?)([\s\S]*)$/,
    reInput = /^input type=(['"])([a-z]+)\1$/,
    reSafeLink = /^([\s\S]*?)<(a href=['"]https?:\/\/[^'" <>]+['"])>(.+?)<\/a>([\s\S]*)$/,
    reLink = /^a href=(['"])(https?:\/\/[^'"]+)\1$/;

var safeTextToTagNode = function(text) {
    var matches, node;
    if ( text.lastIndexOf('a ', 0) === 0 ) {
        matches = reLink.exec(text);
        if ( matches === null ) { return null; }
        node = document.createElement('a');
        node.setAttribute('href', matches[2]);
        return node;
    }
    if ( text.lastIndexOf('input ', 0) === 0 ) {
        matches = reInput.exec(text);
        if ( matches === null ) { return null; }
        node = document.createElement('input');
        node.setAttribute('type', matches[2]);
        return node;
    }
    // Firefox extension validator warns if using a variable as argument for
    // document.createElement().
    switch ( text ) {
    case 'b':
        return document.createElement('b');
    case 'blockquote':
        return document.createElement('blockquote');
    case 'code':
        return document.createElement('code');
    case 'em':
        return document.createElement('em');
    case 'i':
        return document.createElement('i');
    case 'span':
        return document.createElement('span');
    case 'sup':
        return document.createElement('sup');
    default:
        break;
    }
};

var safeTextToTextNode = function(text) {
    // TODO: remove once no more HTML entities in translation files.
    if ( text.indexOf('&') !== -1 ) {
        text = text.replace(/&ldquo;/g, '“')
                   .replace(/&rdquo;/g, '”')
                   .replace(/&lsquo;/g, '‘')
                   .replace(/&rsquo;/g, '’');
    }
    return document.createTextNode(text);
};

var safeTextToDOM = function(text, parent) {
    if ( text === '' ) { return; }
    // Fast path (most common).
    if ( text.indexOf('<') === -1 ) {
        return parent.appendChild(safeTextToTextNode(text));
    }
    // Slow path.
    // `<p>` no longer allowed. Code below can be remove once all <p>'s are
    // gone from translation files.
    text = text.replace(/^<p>|<\/p>/g, '')
               .replace(/<p>/g, '\n\n');
    // Parse allowed HTML tags.
    var matches,
        matches1 = reSafeTags.exec(text),
        matches2 = reSafeLink.exec(text);
    if ( matches1 !== null && matches2 !== null ) {
        matches = matches1.index < matches2.index ? matches1 : matches2;
    } else if ( matches1 !== null ) {
        matches = matches1;
    } else if ( matches2 !== null ) {
        matches = matches2;
    } else {
        matches = reSafeInput.exec(text);
    }
    if ( matches === null ) {
        parent.appendChild(safeTextToTextNode(text));
        return;
    }
    safeTextToDOM(matches[1], parent);
    var node = safeTextToTagNode(matches[2]) || parent;
    safeTextToDOM(matches[3], node);
    parent.appendChild(node);
    safeTextToDOM(matches[4], parent);
};

/******************************************************************************/

// Helper to deal with the i18n'ing of HTML files.
vAPI.i18n.render = function(context) {
    var docu = document,
        root = context || docu,
        elems, n, i, elem, text;

    elems = root.querySelectorAll('[data-i18n]');
    n = elems.length;
    for ( i = 0; i < n; i++ ) {
        elem = elems[i];
        text = vAPI.i18n(elem.getAttribute('data-i18n'));
        if ( !text ) { continue; }
        // TODO: remove once it's all replaced with <input type="...">
        if ( text.indexOf('{') !== -1 ) {
            text = text.replace(/\{\{input:([^}]+)\}\}/g, '<input type="$1">');
        }
        safeTextToDOM(text, elem);
    }

    uDom('[title]', context).forEach(function(elem) {
        var title = vAPI.i18n(elem.attr('title'));
        if ( title ) {
            elem.attr('title', title);
        }
    });

    uDom('[placeholder]', context).forEach(function(elem) {
        elem.attr('placeholder', vAPI.i18n(elem.attr('placeholder')));
    });

    uDom('[data-i18n-tip]', context).forEach(function(elem) {
        elem.attr(
            'data-tip',
            vAPI.i18n(elem.attr('data-i18n-tip')).replace(/<br>/g, '\n').replace(/\n{3,}/g, '\n\n')
        );
    });
};

vAPI.i18n.render();

/******************************************************************************/

vAPI.i18n.renderElapsedTimeToString = function(tstamp) {
    var value = (Date.now() - tstamp) / 60000;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneMinuteAgo');
    }
    if ( value < 60 ) {
        return vAPI.i18n('elapsedManyMinutesAgo').replace('{{value}}', Math.floor(value).toLocaleString());
    }
    value /= 60;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneHourAgo');
    }
    if ( value < 24 ) {
        return vAPI.i18n('elapsedManyHoursAgo').replace('{{value}}', Math.floor(value).toLocaleString());
    }
    value /= 24;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneDayAgo');
    }
    return vAPI.i18n('elapsedManyDaysAgo').replace('{{value}}', Math.floor(value).toLocaleString());
};

/******************************************************************************/

})();

/******************************************************************************/
