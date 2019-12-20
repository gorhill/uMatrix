/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-2018  Raymond Hill

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

/* global uDom */

'use strict';

{
// >>>>> start of local scope

/******************************************************************************/

const loadDashboardPanel = function(hash) {
    const button = uDom(hash);
    const url = button.attr('data-dashboard-panel-url');
    uDom('iframe').attr('src', url);
    uDom('.tabButton').forEach(function(button){
        button.toggleClass(
            'selected',
            button.attr('data-dashboard-panel-url') === url
        );
    });
};

const onTabClickHandler = function() {
    loadDashboardPanel(window.location.hash);
};

uDom.onLoad(function() {
    window.addEventListener('hashchange', onTabClickHandler);
    let hash = window.location.hash;
    if ( hash.length < 2 ) {
        hash = '#settings';
    }
    loadDashboardPanel(hash);
});

/******************************************************************************/

// <<<<< end of local scope
}
