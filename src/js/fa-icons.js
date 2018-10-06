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

'use strict';

/******************************************************************************/

let faIconsInit = function(root) {
    let icons = (root || document).querySelectorAll('.fa-icon');
    for ( let icon of icons ) {
        if ( icon.childElementCount !== 0 ) { continue; }
        let name = icon.textContent;
        let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('fa-icon_' + name);
        let use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        let href = '/img/fontawesome/fontawesome-defs.svg#' + name;
        use.setAttribute('href', href);
        use.setAttribute('xlink:href', href);
        svg.appendChild(use);
        icon.textContent = '';
        icon.appendChild(svg);
        if ( icon.classList.contains('fa-icon-badged') ) {
            let badge = document.createElement('span');
            badge.className = 'fa-icon-badge';
            icon.appendChild(badge);
        }
    }
};

faIconsInit();
