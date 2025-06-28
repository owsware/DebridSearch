import PremiumizeClient from 'premiumize-api'
import Fuse from 'fuse.js'
import { isVideo } from './util/extension-util.js'
import PTT from './util/parse-torrent-title.js'

async function searchFiles(apiKey, searchKey, threshold = 0.3) {
    console.log('Search files with searchKey: ' + searchKey)

    const PM = new PremiumizeClient(apiKey)
    let files = []

    await PM.item.listAll()
        .then(result => {
            if (result.status === 'success') {
                files = result.files
            }
        })
        .catch(err => handleError(err))

    const torrents = files.map(file => toTorrent(file))
    const fuse = new Fuse(torrents, {
        keys: ['info.title'],
        threshold: threshold,
        minMatchCharLength: 2
    })

    const searchResults = fuse.search(searchKey)
    if (searchResults && searchResults.length) {
        return searchResults.map(searchResult => searchResult.item)
    } else {
        return []
    }
}

async function listFiles(apiKey, skip = 0) {
    const PM = new PremiumizeClient(apiKey)
    let files = []

    await PM.item.listAll()
        .then(result => {
            if (result.status === 'success') {
                files = result.files
            }
        })
        .catch(err => handleError(err))

    const metas = files.map(file => ({
        id: 'premiumize:' + file.id,
        name: file.name,
        type: 'other'
    }))

    return metas.slice(skip, skip + 50)
}

async function getTorrentDetails(apiKey, id) {
    const PM = new PremiumizeClient(apiKey)

    return await PM.item.details(id)
        .then(result => toTorrentDetails(result))
        .catch(err => handleError(err))
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
    const link = item.directlink || item.stream_link || item.link
    const videos = []
    if (isVideo(link)) {
        videos.push({
            id: item.id,
            name: item.name,
            url: link,
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

function handleError(err) {
    console.log(err)
    return Promise.reject(err)
}

export default { listFiles, searchFiles, getTorrentDetails }
