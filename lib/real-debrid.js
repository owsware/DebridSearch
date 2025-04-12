import RealDebridClient from 'real-debrid-api';
import Fuse from 'fuse.js';
import { isVideo } from './util/extension-util.js';
import PTT from './util/parse-torrent-title.js';
import { BadTokenError, AccessDeniedError } from './util/error-codes.js';
import { FILE_TYPES } from './util/file-types.js';
import { encode } from 'urlencode';

// Validate environment variables at startup
if (!process.env.ADDON_URL) {
    throw new Error('ADDON_URL environment variable is missing');
}

async function searchFiles(fileType, apiKey, searchKey, threshold) {
    console.log(`RealDebrid Search ${fileType.description} with searchKey: ${searchKey}`);

    const files = await listFilesParrallel(fileType, apiKey, 1, 1000);
    //console.log(`Raw files from API for ${fileType.description}:`, files.map(f => ({
      //  id: f.id,
        //filename: f.filename,
        //links: f.links?.length || 'none'
    //})));

    if (!Array.isArray(files)) {
        console.error(`Expected an array from listFilesParrallel, got:`, files);
        return [];
    }

    let results = [];
    if (fileType == FILE_TYPES.TORRENTS) {
        results = files.map(result => toTorrent(result));
    } else if (fileType == FILE_TYPES.DOWNLOADS) {
        results = files.map(result => toDownload(result, apiKey));
    }
    results = results.map(result => {
        result.fileType = fileType;
        return result;
    });

    if (!searchKey) {
        return results;
    }

    const fuse = new Fuse(results, {
        keys: ['info.title', 'name'],
        threshold: threshold,
        minMatchCharLength: 2
    });

    const searchResults = fuse.search(searchKey);
    const finalResults = searchResults && searchResults.length
        ? searchResults.map(searchResult => searchResult.item)
        : [];
    console.log(`RealDebrid searchFiles ${fileType.description} results:`, finalResults.map(r => ({
        id: r.id,
        name: r.name
    })));
    return finalResults;
}

async function searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
    return searchFiles(FILE_TYPES.TORRENTS, apiKey, searchKey, threshold);
}

async function searchDownloads(apiKey, searchKey = null, threshold = 0.3) {
    return searchFiles(FILE_TYPES.DOWNLOADS, apiKey, searchKey, threshold);
}

async function getTorrentDetails(apiKey, id) {
    const RD = new RealDebridClient(apiKey);
    try {
        const resp = await RD.torrents.info(id);
        //console.log(`Torrent ${id} raw data:`, {
          //  id: resp.data.id,
            //filename: resp.data.filename,
            //files: resp.data.files?.map(f => ({
              //  id: f.id,
                //path: f.path,
                //selected: f.selected,
                //isVideo: isVideo(f.path)
            //})) || 'none',
           // links: resp.data.links?.length ? resp.data.links : 'none'
        //});
        return await toTorrentDetails(apiKey, resp.data);
    } catch (err) {
        return handleError(err);
    }
}

async function toTorrentDetails(apiKey, item) {
    const RD = new RealDebridClient(apiKey);
    let links = item.links || [];
    let files = item.files || [];

    // If links are empty or no selected video files, try refreshing
    if ((!links.length || !files.some(f => f.selected && isVideo(f.path))) && item.status === 'downloaded') {
        try {
            // Select all files to generate links
            await RD.torrents.selectFiles(item.id, 'all').catch(err => {
                console.warn(`Failed to select files for torrent ${item.id}: ${item.filename}`, err);
            });
            // Refresh torrent info
            const refreshed = await RD.torrents.info(item.id);
            files = refreshed.data.files || [];
            links = refreshed.data.links || [];
            console.log(`Refreshed torrent ${item.id}: files=${files.length}, links=${links.length}`);
        } catch (err) {
            console.error(`Failed to refresh torrent ${item.id}: ${item.filename}`, err);
            // Continue with empty data to avoid breaking
        }
    }

    const videos = files
        .filter(file => file.selected)
        .filter(file => isVideo(file.path))
        .map((file, index) => {
            const hostUrl = links.at(index) || '';
            const url = hostUrl
                ? `${process.env.ADDON_URL}/resolve/RealDebrid/${apiKey}/${item.id}/${encode(hostUrl)}`
                : `${process.env.ADDON_URL}/resolve/RealDebrid/${apiKey}/${item.id}/file/${file.id}`;
            return {
                id: `${item.id}:${file.id}`,
                name: file.path,
                url: url,
                size: file.bytes,
                created: new Date(item.added),
                info: PTT.parse(file.path)
            };
        })
        .filter(video => video.url);

    return {
        source: 'realdebrid',
        id: item.id,
        name: item.filename,
        type: 'other',
        hash: item.hash,
        info: PTT.parse(item.filename),
        size: item.bytes,
        created: new Date(item.added),
        videos: videos
    };
}

async function unrestrictUrl(apiKey, hostUrl, clientIp) {
    const options = getDefaultOptions(clientIp);
    const RD = new RealDebridClient(apiKey, options);

    try {
        const resp = await RD.unrestrict.link(hostUrl);
        console.log(`Unrestricted URL for ${hostUrl}:`, resp.data.download);
        return resp.data.download;
    } catch (err) {
        return handleError(err);
    }
}

function toTorrent(item) {
    return {
        source: 'realdebrid',
        id: item.id,
        name: item.filename,
        type: 'other',
        info: PTT.parse(item.filename),
        size: item.bytes,
        created: new Date(item.added),
        links: item.links // Include for debugging
    };
}

function toDownload(item, apiKey) {
    let downloadUrl = item.download;
    if (!downloadUrl && item.status === 'downloaded') {
        downloadUrl = `torrent/${item.id}`;
        console.log(`Using fallback download URL for ${item.id}: ${downloadUrl}`);
    }
    if (!downloadUrl) {
        console.warn(`No download URL for item ${item.id}: ${item.filename}`);
        return null;
    }
    downloadUrl = `${process.env.ADDON_URL}/resolve/RealDebrid/${apiKey}/${item.id}/${encode(downloadUrl)}`;
    return {
        source: 'realdebrid',
        id: item.id,
        url: downloadUrl,
        name: item.filename,
        type: 'other',
        info: PTT.parse(item.filename),
        size: item.filesize || item.bytes,
        created: new Date(item.generated || item.added),
        fileType: FILE_TYPES.DOWNLOADS,
        videos: [{
            url: downloadUrl,
            name: item.filename,
            size: item.filesize || item.bytes,
            info: PTT.parse(item.filename)
        }]
    };
}

async function listTorrents(apiKey, skip = 0) {
    let nextPage = Math.floor(skip / 50) + 1;

    const torrents = await listFilesParrallel(FILE_TYPES.TORRENTS, apiKey, nextPage);
    const metas = torrents.map(torrent => ({
        id: 'realdebrid:' + torrent.id,
        name: torrent.filename,
        type: 'other',
    }));
    console.log(`listTorrents:`, metas.map(m => m.id));
    return metas || [];
}

async function listFilesParrallel(fileType, apiKey, page = 1, pageSize = 50) {
    const RD = new RealDebridClient(apiKey, {
        params: {
            page: page,
            limit: pageSize
        }
    });

    if (fileType == FILE_TYPES.TORRENTS) {
        return await RD.torrents.get(0, page, pageSize)
            .then(resp => {
                return resp.data || [];
            })
            .catch(err => handleError(err));
    } else if (fileType == FILE_TYPES.DOWNLOADS) {
        let files = [];
        let finished = false;
        let currentPage = page;
        while (!finished) {
            const resp = await RD.downloads.get(0, currentPage, 50)
                .catch(err => handleError(err));
            const data = resp.data || [];
            files.push(...data);
            finished = resp.status === 204 || data.length === 0;
            currentPage++;
        }
        console.log(`listFilesParrallel downloads: ${files.length} files`);
        return files; // Removed host filter to include all files
    }
}

function handleError(err) {
    console.error(`API error:`, err.message);
    const errData = err.response?.data;
    if (errData && errData.error_code === 8) {
        return Promise.reject(BadTokenError);
    }
    if (errData && accessDeniedError(errData)) {
        return Promise.reject(AccessDeniedError);
    }
    return Promise.reject(err);
}

function accessDeniedError(errData) {
    return [9, 20].includes(errData?.error_code);
}

function getDefaultOptions(ip) {
    return { ip };
}

export default { listTorrents, searchTorrents, getTorrentDetails, unrestrictUrl, searchDownloads };