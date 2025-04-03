import AllDebridClient from 'all-debrid-api'
import Fuse from 'fuse.js'
import { isVideo } from './util/extension-util.js'
import PTT from './util/parse-torrent-title.js'
import { BadTokenError } from './util/error-codes.js'
import { encode } from 'urlencode'

const ADDON_URL = process.env.ADDON_URL || 'http://127.0.0.1:55771'

async function searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
    console.log("Search torrents and saved links with searchKey: " + searchKey)

    const [torrentsResults, savedLinksResults] = await Promise.all([
        listTorrentsParallel(apiKey),
        listSavedLinks(apiKey)
    ])

    const torrents = torrentsResults.map(torrentsResult => toTorrent(torrentsResult))
    const savedLinks = savedLinksResults
    const allItems = [...torrents, ...savedLinks]

    if (!searchKey) {
        return allItems
    }

    const fuse = new Fuse(allItems, {
        keys: ['info.title', 'name'],
        threshold: threshold,
        minMatchCharLength: 2
    })
    const searchResults = fuse.search(searchKey)

    return searchResults && searchResults.length ? searchResults.map(searchResult => searchResult.item) : []
}

async function getTorrentDetails(apiKey, id) {
    const AD = new AllDebridClient(apiKey)
    return await AD.magnet.status(id)
        .then(res => {
            if (!res.data || !res.data.magnets || !res.data.magnets.links) {
                console.log(`No valid torrent data for ID ${id}:`, res.data)
                return null
            }
            return toTorrentDetails(apiKey, res.data.magnets)
        })
        .catch(err => handleError(err))
}

async function toTorrentDetails(apiKey, item) {
    const videos = (item.links || [])
        .filter(file => isVideo(file.filename))
        .map((file, index) => {
            const hostUrl = file.link
            const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${item.id}/${encode(hostUrl)}`
            return {
                id: `${item.id}:${index}`,
                name: file.filename,
                url: url,
                size: file.size || 0,
                created: new Date(item.completionDate),
                info: PTT.parse(file.filename)
            }
        })

    return {
        source: 'alldebrid',
        id: item.id,
        name: item.filename || 'Unknown',
        type: 'other',
        hash: item.hash || '',
        info: PTT.parse(item.filename || ''),
        size: item.size || 0,
        created: new Date(item.completionDate || Date.now()),
        videos: videos
    }
}

async function unrestrictUrl(apiKey, hostUrl) {
    const AD = new AllDebridClient(apiKey)
    return AD.link.unlock(hostUrl)
        .then(res => res.data.link)
        .catch(err => handleError(err))
}

function toTorrent(item) {
    const info = PTT.parse(item.filename)
    //console.log('Parsed torrent info:', item.filename, '->', info)
    return {
        source: 'alldebrid',
        id: item.id,
        name: item.filename,
        type: 'other',
        info: info,
        size: item.size,
        created: new Date(item.completionDate),
    }
}

async function listTorrents(apiKey) {
    let torrents = await listTorrentsParallel(apiKey)
    const metas = torrents.map(torrent => ({
        id: 'alldebrid:' + torrent.id,
        name: torrent.filename,
        type: 'other',
    }))
    return metas || []
}

async function listTorrentsParallel(apiKey) {
    const AD = new AllDebridClient(apiKey)
    try {
        const res = await AD.magnet.status()
        if (!res || !res.data || !Array.isArray(res.data.magnets)) {
            console.error('Unexpected magnet status response:', res)
            return []
        }
        return res.data.magnets.filter(item => item.statusCode === 4) || []
    } catch (err) {
        return handleError(err)
    }
}

async function listSavedLinks(apiKey) {
    const AD = new AllDebridClient(apiKey)
    return await AD.user.links()
        .then(res => res.data.links.map(link => {
            const info = PTT.parse(link.filename)
            //console.log('Parsed saved link info:', link.filename, '->', info)
            return {
                source: 'alldebrid',
                id: link.link,
                name: link.filename || link.link.split('/').pop(),
                type: 'direct',
                url: link.link,
                size: link.size || 0,
                created: new Date(link.date * 1000),
                info: info
            }
        }))
        .catch(err => handleError(err))
}

function handleError(err) {
    console.error('Error in AllDebrid operation:', err)
    if (err && err.code === 'AUTH_BAD_APIKEY') {
        return Promise.reject(BadTokenError)
    }
    return Promise.reject(err)
}

export default { 
    listTorrents, 
    searchTorrents, 
    getTorrentDetails, 
    unrestrictUrl, 
    listSavedLinks 
}

export { ADDON_URL } 