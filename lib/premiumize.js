import fetch from 'node-fetch'
import Fuse from 'fuse.js'
import { isVideo } from './util/extension-util.js'
import PTT from './util/parse-torrent-title.js'
import { BadTokenError, AccessDeniedError } from './util/error-codes.js'
import { encode } from 'urlencode'

const BASE_URL = 'https://www.premiumize.me/api'

async function request(apiKey, endpoint, params = {}) {
    const url = new URL(BASE_URL + endpoint)
    url.searchParams.set('apikey', apiKey)
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
            url.searchParams.set(k, v)
        }
    })
    const resp = await fetch(url)
    if (!resp.ok) {
        throw new Error('HTTP ' + resp.status)
    }
    const data = await resp.json()
    if (data.status && data.status !== 'success') {
        if (/apikey/i.test(data.message || '')) {
            throw BadTokenError
        }
        if (/denied/i.test(data.message || '')) {
            throw AccessDeniedError
        }
        throw new Error(data.message || 'API error')
    }
    return data
}

async function searchFiles(apiKey, searchKey, threshold = 0.3) {
    console.log('Search files with searchKey: ' + searchKey)

    const data = await request(apiKey, '/folder/search', { q: searchKey })
    const files = (data.content || []).filter(item => item.type === 'file')
    const torrents = files.map(file => toTorrent(file))
    const fuse = new Fuse(torrents, {
        keys: ['info.title'],
        threshold: threshold,
        minMatchCharLength: 2
    })

    const searchResults = fuse.search(searchKey)
    return searchResults && searchResults.length
        ? searchResults.map(searchResult => searchResult.item)
        : []
}

async function listFiles(apiKey, skip = 0) {
    const data = await request(apiKey, '/item/listall')
    const metas = (data.files || []).map(item => ({
        id: 'premiumize:' + item.id,
        name: item.name,
        type: 'other'
    }))
    return metas.slice(skip, skip + 50)
}

async function getTorrentDetails(apiKey, id) {
    const data = await request(apiKey, '/item/details', { id })
    return toTorrentDetails(data)
}

function toTorrent(item) {
    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        info: PTT.parse(item.name),
        size: item.size,
        created: new Date(item.created_at * 1000),
    }
}

function toTorrentDetails(item) {
    let videos = []
    const link = item.stream_link || item.directlink
    if (isVideo(link)) {
        videos.push({
            id: item.id,
            name: item.name,
            url: `${process.env.ADDON_URL}/resolve/Premiumize/null/${item.id}/${encode(link)}`,
            size: item.size,
            created: new Date(item.created_at * 1000),
            info: PTT.parse(item.name)
        })
    }

    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        info: PTT.parse(item.name),
        hash: item.id.toLowerCase(),
        size: item.size,
        created: new Date(item.created_at * 1000),
        videos: videos || []
    }
}

export default { listFiles, searchFiles, getTorrentDetails }
