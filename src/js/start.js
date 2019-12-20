/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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

(async ( ) => {
    const µm = µMatrix;

    await Promise.all([
        µm.loadPublicSuffixList(),
        µm.loadUserSettings(),
    ]);
    log.info(`PSL and user settings ready ${Date.now()-vAPI.T0} ms after launch`);

    {
        let trieDetails;
        try {
            trieDetails = JSON.parse(
                vAPI.localStorage.getItem('ubiquitousBlacklist.trieDetails')
            );
        } catch(ex) {
        }
        µm.ubiquitousBlacklist = new µm.HNTrieContainer(trieDetails);
        µm.ubiquitousBlacklist.initWASM();
    }
    log.info(`Ubiquitous block container ready ${Date.now()-vAPI.T0} ms after launch`);

    await Promise.all([
        µm.loadRawSettings(),
        µm.loadMatrix(),
        µm.loadHostsFiles(),
    ]);
    log.info(`Ubiquitous block rules ready ${Date.now()-vAPI.T0} ms after launch`);

    {
        const pageStore =
            µm.pageStoreFactory(µm.tabContextManager.mustLookup(vAPI.noTabId));
        pageStore.title = vAPI.i18n('statsPageDetailedBehindTheScenePage');
        µm.pageStores.set(vAPI.noTabId, pageStore);
    }

    const tabs = await vAPI.tabs.query({ url: '<all_urls>' });
    if ( Array.isArray(tabs) ) {
        for ( const tab of tabs ) {
            µm.tabContextManager.push(tab.id, tab.url, 'newURL');
            µm.bindTabToPageStats(tab.id);
            µm.setPageStoreTitle(tab.id, tab.title);
        }
    }
    log.info(`Tab stores ready ${Date.now()-vAPI.T0} ms after launch`);

    µm.webRequest.start();

    µm.loadRecipes();

    // https://github.com/uBlockOrigin/uMatrix-issues/issues/63
    //   Ensure user settings are fully loaded before launching the
    //   asset updater.
    µm.assets.addObserver(µm.assetObserver.bind(µm));
    µm.scheduleAssetUpdater(µm.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);
})();

/******************************************************************************/
