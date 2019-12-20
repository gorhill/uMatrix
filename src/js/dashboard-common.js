/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014 Raymond Hill

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

/* global CodeMirror, uDom */

'use strict';

/******************************************************************************/

{
// >>>>> start of local scope

/******************************************************************************/

self.uBlockDashboard = self.uBlockDashboard || {};

/******************************************************************************/

{
    let grabFocusTimer;
    let grabFocusTarget;

    const grabFocus = function() {
        grabFocusTarget.focus();
        grabFocusTimer = grabFocusTarget = undefined;
    };
    const grabFocusAsync = function(cm) {
        grabFocusTarget = cm;
        if ( grabFocusTimer === undefined ) {
            grabFocusTimer = vAPI.setTimeout(grabFocus, 1);
        }
    };

    // https://github.com/gorhill/uBlock/issues/3646
    const patchSelectAll = function(cm, details) {
        var vp = cm.getViewport();
        if ( details.ranges.length !== 1 ) { return; }
        var range = details.ranges[0],
            lineFrom = range.anchor.line,
            lineTo = range.head.line;
        if ( lineTo === lineFrom ) { return; }
        if ( range.head.ch !== 0 ) { lineTo += 1; }
        if ( lineFrom !== vp.from || lineTo !== vp.to ) { return; }
        details.update([
            {
                anchor: { line: 0, ch: 0 },
                head: { line: cm.lineCount(), ch: 0 }
            }
        ]);
        grabFocusAsync(cm);
    };

    let lastGutterClick = 0;
    let lastGutterLine = 0;

    const onGutterClicked = function(cm, line) {
        const delta = Date.now() - lastGutterClick;
        if ( delta >= 500 || line !== lastGutterLine ) {
            cm.setSelection(
                { line: line, ch: 0 },
                { line: line + 1, ch: 0 }
            );
            lastGutterClick = Date.now();
            lastGutterLine = line;
        } else {
            cm.setSelection(
                { line: 0, ch: 0 },
                { line: cm.lineCount(), ch: 0 },
                { scroll: false }
            );
            lastGutterClick = 0;
        }
        grabFocusAsync(cm);
    };

    let resizeTimer,
        resizeObserver;
    const resize = function(cm) {
        resizeTimer = undefined;
        const child = document.querySelector('.codeMirrorFillVertical');
        if ( child === null ) { return; }
        const prect = document.documentElement.getBoundingClientRect();
        const crect = child.getBoundingClientRect();
        const cssHeight = Math.floor(Math.max(prect.bottom - crect.top, 80)) + 'px';
        if ( child.style.height === cssHeight ) { return; }
        child.style.height = cssHeight;
        // https://github.com/gorhill/uBlock/issues/3694
        //   Need to call cm.refresh() when resizing occurs. However the
        //   cursor position may end up outside the viewport, hence we also
        //   call cm.scrollIntoView() to address this.
        //   Reference: https://codemirror.net/doc/manual.html#api_sizing
        if ( cm instanceof CodeMirror ) {
            cm.refresh();
            cm.scrollIntoView(null);
        }
    };
    const resizeAsync = function(cm, delay) {
        if ( resizeTimer !== undefined ) { return; }
        resizeTimer = vAPI.setTimeout(
            resize.bind(null, cm),
            typeof delay === 'number' ? delay : 66
        );
    };

    self.uBlockDashboard.patchCodeMirrorEditor = function(cm) {
        if ( document.querySelector('.codeMirrorFillVertical') !== null ) {
            const boundResizeAsync = resizeAsync.bind(null, cm);
            window.addEventListener('resize', boundResizeAsync);
            resizeObserver = new MutationObserver(boundResizeAsync);
            resizeObserver.observe(document.querySelector('.body'), {
                childList: true,
                subtree: true
            });
            resizeAsync(cm, 1);
        }
        if ( cm.options.inputStyle === 'contenteditable' ) {
            cm.on('beforeSelectionChange', patchSelectAll);
        }
        cm.on('gutterClick', onGutterClicked);
    };
}

uDom('a').attr('target', '_blank');
uDom('a[href*="dashboard.html"]').attr('target', '_parent');
uDom('.whatisthis').on('click', ev => {
    ev.target
      .parentElement
      .querySelector('.whatisthis-expandable')
      .classList.toggle('whatisthis-expanded');
});

// <<<<< end of local scope
}
