import DebridLink from './debrid-link.js'
import RealDebrid from './real-debrid.js'
import AllDebrid from './all-debrid.js'
import Premiumize from './premiumize.js'
import TorBox from './torbox.js'
import { BadRequestError } from './util/error-codes.js'

async function searchTorrents(config, searchKey, skip = 0) {
    let resultsPromise
    if (config.DebridLinkApiKey) {
        resultsPromise = DebridLink.searchTorrents(config.DebridLinkApiKey, searchKey)
    } else if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = RealDebrid.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "AllDebrid") {
        const torrentsPromise = AllDebrid.searchTorrents(config.DebridApiKey, searchKey)
        const savedLinksPromise = AllDebrid.listSavedLinks(config.DebridApiKey)
            .then(links => links.filter(link => link.name.toLowerCase().includes(searchKey.toLowerCase())))

        resultsPromise = Promise.all([torrentsPromise, savedLinksPromise])
            .then(([torrents, savedLinks]) => [...torrents, ...savedLinks]);
    } else if (config.DebridProvider == "Premiumize") {
        resultsPromise = Premiumize.searchFiles(config.DebridApiKey, searchKey, 0.3, skip)
    } else if (config.DebridProvider == "TorBox") {
        resultsPromise = Promise.resolve([])
    } else {
        return Promise.reject(BadRequestError)
    }

    return resultsPromise
        .then(torrents => torrents.map(torrent => toMeta(torrent)))
}

async function listTorrents(config, skip = 0) {
    if (!config.ShowCatalog) {
        return Promise.resolve([])
    }

    let resultsPromise

    if (config.DebridLinkApiKey) {
        resultsPromise = DebridLink.listTorrents(config.DebridLinkApiKey, skip)
    } else if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = RealDebrid.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "AllDebrid") {
        const torrentsPromise = AllDebrid.listTorrents(config.DebridApiKey)
        const savedLinksPromise = AllDebrid.listSavedLinks(config.DebridApiKey)

        resultsPromise = Promise.all([torrentsPromise, savedLinksPromise])
            .then(([torrents, savedLinks]) => {
                const combined = [...torrents, ...savedLinks];
                return combined.slice(skip, skip + 50);
            });
    } else if (config.DebridProvider == "Premiumize") {
        resultsPromise = Premiumize.listFiles(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "TorBox") {
        resultsPromise = Promise.resolve([])
    } else {
        return Promise.reject(BadRequestError)
    }

    return resultsPromise
}

function toMeta(torrent) {
    return {
        id: torrent.source + ':' + torrent.id,
        name: torrent.name,
        type: torrent.type,
        // poster: `https://img.icons8.com/ios/256/video--v1.png`,
        // posterShape: 'square'
    }
}


export default { searchTorrents, listTorrents }