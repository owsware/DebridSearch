import PremiumizeClient from 'premiumize-api'
import Fuse from 'fuse.js'
import { isVideo } from './util/extension-util.js'
import PTT from './util/parse-torrent-title.js'

async function searchFiles(apiKey, searchKey, threshold = 0.3, skip = 0) {
    console.log('Search files with searchKey: ' + searchKey)

    const PM = new PremiumizeClient(apiKey)
    let files = []

    try {
        const result = await PM.item.listAll()
        if (result.status === 'success') {
            files = result.files
        }
    } catch (err) {
        await handleError(err)
    }

    const torrents = files.map(file => toTorrent(file))
    const fuse = new Fuse(torrents, {
        keys: ['info.title'],
        threshold: threshold,
        minMatchCharLength: 2
    })

    const searchResults = fuse.search(searchKey)
    if (!searchResults || !searchResults.length) {
        return []
    }

    return searchResults
        .map(result => result.item)
        .slice(skip, skip + 50)
}

async function listFiles(apiKey, skip = 0) {
    const PM = new PremiumizeClient(apiKey)
    let files = []

    try {
        const result = await PM.item.listAll()
        if (result.status === 'success') {
            files = result.files
        }
    } catch (err) {
        await handleError(err)
    }

    const metas = files.map(file => ({
        id: 'premiumize:' + file.id,
        name: file.name,
        type: 'other'
    }))

    return metas.slice(skip, skip + 50)
}

async function getTorrentDetails(apiKey, id) {
    const PM = new PremiumizeClient(apiKey)
    try {
        const result = await PM.item.details(id)
        return toTorrentDetails(result)
    } catch (err) {
        await handleError(err)
        return null
    }
}

function toTorrent(item) {
    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        info: Object.assign(PTT.parse(item.name), {
            resolution: item.resy ? `${item.resy}p` : undefined
        }),
        size: item.size,
        created: new Date(item.created_at * 1000),
    }
}

function toTorrentDetails(item) {
    const link = item.directlink || item.link
    const videos = []
    if (isVideo(link)) {
        videos.push({
            id: item.id,
            name: item.name,
            url: link,
            size: item.size,
            created: new Date(item.created_at * 1000),
            info: Object.assign(PTT.parse(item.name), {
                resolution: item.resy ? `${item.resy}p` : undefined
            })
        })
    }

    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        info: Object.assign(PTT.parse(item.name), {
            resolution: item.resy ? `${item.resy}p` : undefined
        }),
        hash: item.id.toLowerCase(),
        size: item.size,
        created: new Date(item.created_at * 1000),
        videos: videos || []
    }
}

async function handleError(err) {
    console.log(err)
}

export default { listFiles, searchFiles, getTorrentDetails }
