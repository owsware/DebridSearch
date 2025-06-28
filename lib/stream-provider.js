import Cinemeta from './util/cinemeta.js';
import DebridLink from './debrid-link.js';
import RealDebrid from './real-debrid.js';
import AllDebrid, { ADDON_URL } from './all-debrid.js';
import Premiumize from './premiumize.js';
import TorBox from './torbox.js';
import { BadRequestError } from './util/error-codes.js';
import { FILE_TYPES } from './util/file-types.js';
import { encode } from 'urlencode';

// Validate environment variables
if (!process.env.ADDON_URL && !ADDON_URL) {
    throw new Error('ADDON_URL environment variable or constant is missing');
}

const STREAM_NAME_MAP = {
    debridlink: "[DL (Your Media)] DebridSearch",
    realdebrid: "[RD (Your Media)] DebridSearch",
    alldebrid: "[AD (Your Media)] DebridSearch",
    premiumize: "[PM (Your Media)] DebridSearch",
    torbox: "[TB (Your Media)] DebridSearch"
};

async function getMovieStreams(config, type, id) {
    const cinemetaDetails = await Cinemeta.getMeta(type, id);
    if (!cinemetaDetails.name) {
        console.error(`Cinemeta failed for ID ${id}:`, cinemetaDetails);
        return [];
    }
    const searchKey = cinemetaDetails.name;
    console.log(`getMovieStreams: ID=${id}, SearchKey=${searchKey}, Year=${cinemetaDetails.year}`);

    let apiKey = config.DebridLinkApiKey || config.DebridApiKey;
    if (!apiKey) {
        console.error('No API key provided for Debrid provider');
        return [];
    }

    if (config.DebridProvider === "RealDebrid") {
        let results = [];
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`searchTorrents failed for ${searchKey}:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails, 'torrent'))
                .map(torrent => {
                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (!torrentDetails.videos || torrentDetails.videos.length === 0) {
                                console.warn(`No videos for torrent ${torrent.id}: ${torrent.name}`);
                                return null;
                            }
                            return toStream(torrentDetails, type);
                        })
                        .catch(err => {
                            console.error(`Error fetching details for ${torrent.id}: ${torrent.name}`, err);
                            return null;
                        });
                }));
            results.push(...streams.filter(stream => stream));
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.3).catch(err => {
            console.error(`searchDownloads failed for ${searchKey}:`, err);
            return [];
        });
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterYear(download, cinemetaDetails, 'download'))
                .map(download => {
                    return toStream(download, type);
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`RealDebrid Final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridLinkApiKey || config.DebridProvider === "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`DebridLink searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails, 'torrent'))
                .map(torrent => torrent.id);

            if (torrentIds && torrentIds.length) {
                return await DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList.map(torrentDetails => toStream(torrentDetails));
                    })
                    .catch(err => {
                        console.error(`DebridLink getTorrentDetails failed:`, err);
                        return [];
                    });
            }
        }
    } else if (config.DebridProvider === "AllDebrid") {
        let results = [];
        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`AllDebrid searchTorrents failed:`, err);
            return [];
        });
        if (items && items.length) {
            const streams = await Promise.all(
                items
                    .filter(item => filterYear(item, cinemetaDetails, 'item'))
                    .map(async item => {
                        try {
                            if (item.type === 'direct') {
                                const hostUrl = item.url;
                                const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`;
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type);
                            } else {
                                const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id);
                                if (!torrentDetails) {
                                    console.warn(`Skipping AllDebrid torrent ${item.id}: No valid data`);
                                    return null;
                                }
                                return toStream(torrentDetails);
                            }
                        } catch (err) {
                            console.error(`AllDebrid ${item.type} error for ${item.id}:`, err);
                            return null;
                        }
                    })
            );
            results.push(...streams.filter(stream => stream));
        }
        console.log(`AllDebrid final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridProvider === "Premiumize") {
        const files = await Premiumize.searchFiles(apiKey, searchKey, 0.3).catch(err => {
            console.error(`Premiumize searchFiles failed:`, err);
            return [];
        });
        if (files && files.length) {
            const streams = await Promise.all(
                files
                    .filter(file => filterYear(file, cinemetaDetails, 'file'))
                    .map(torrent => {
                        return Premiumize.getTorrentDetails(apiKey, torrent.id)
                            .then(torrentDetails => toStream(torrentDetails))
                            .catch(err => {
                                console.error(`Premiumize getTorrentDetails failed for ${torrent.id}:`, err);
                                return null;
                            });
                    })
            );
            console.log(`Premiumize final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else if (config.DebridProvider === "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`TorBox searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterYear(torrent, cinemetaDetails, 'torrent'))
                    .map(torrentDetails => toStream(torrentDetails))
            );
            console.log(`TorBox final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else {
        console.error(`Invalid DebridProvider: ${config.DebridProvider}`);
        return Promise.reject(BadRequestError);
    }

    return [];
}

async function getSeriesStreams(config, type, id) {
    const [imdbId, season, episode] = id.split(":");
    const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
    if (!cinemetaDetails.name) {
        console.error(`Cinemeta failed for ID ${imdbId}:`, cinemetaDetails);
        return [];
    }
    const searchKey = cinemetaDetails.name;
    console.log(`getSeriesStreams: ID=${imdbId}, SearchKey=${searchKey}, Season=${season}, Episode=${episode}`);

    let apiKey = config.DebridLinkApiKey || config.DebridApiKey;
    if (!apiKey) {
        console.error('No API key provided for Debrid provider');
        return [];
    }

    if (config.DebridProvider === "RealDebrid") {
        let results = [];
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`RealDebrid searchTorrents failed for ${searchKey}:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (!torrentDetails.videos || torrentDetails.videos.length === 0) {
                                console.warn(`No videos for torrent ${torrent.id}: ${torrent.name}`);
                                return null;
                            }
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                            return null;
                        })
                        .catch(err => {
                            console.error(`Error fetching details for ${torrent.id}: ${torrent.name}`, err);
                            return null;
                        });
                }));
            results.push(...streams.filter(stream => stream));
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.3).catch(err => {
            console.error(`RealDebrid searchDownloads failed for ${searchKey}:`, err);
            return [];
        });
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterDownloadEpisode(download, season, episode))
                .map(download => {
                    return toStream(download, type);
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`RealDebrid Final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridLinkApiKey || config.DebridProvider === "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`DebridLink searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => torrent.id);

            if (torrentIds && torrentIds.length) {
                return DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList
                            .filter(torrentDetails => filterEpisode(torrentDetails, season, episode))
                            .map(torrentDetails => toStream(torrentDetails, type));
                    })
                    .catch(err => {
                        console.error(`DebridLink getTorrentDetails failed:`, err);
                        return [];
                    });
            }
        }
    } else if (config.DebridProvider === "AllDebrid") {
        let results = [];
        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`AllDebrid searchTorrents failed:`, err);
            return [];
        });
        if (items && items.length) {
            const streams = await Promise.all(items
                .filter(item => filterSeason(item, season))
                .map(async item => {
                    try {
                        if (item.type === 'direct') {
                            const hostUrl = item.url;
                            const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`;
                            if (filterDownloadEpisode(item, season, episode)) {
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type);
                            }
                        } else {
                            const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id);
                            if (!torrentDetails) {
                                console.warn(`Skipping AllDebrid torrent ${item.id}: No valid data`);
                                return null;
                            }
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                        }
                    } catch (err) {
                        console.error(`AllDebrid ${item.type} error for ${item.id}:`, err);
                        return null;
                    }
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`AllDebrid final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridProvider === "Premiumize") {
        const torrents = await Premiumize.searchFiles(apiKey, searchKey, 0.3).catch(err => {
            console.error(`Premiumize searchFiles failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return Premiumize.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                            return null;
                        })
                        .catch(err => {
                            console.error(`Premiumize getTorrentDetails failed for ${torrent.id}:`, err);
                            return null;
                        });
                })
            );
            console.log(`Premiumize final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else if (config.DebridProvider === "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`TorBox searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterEpisode(torrent, season, episode))
                    .map(torrentDetails => toStream(torrentDetails, type))
            );
            console.log(`TorBox final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else {
        console.error(`Invalid DebridProvider: ${config.DebridProvider}`);
        return Promise.reject(BadRequestError);
    }

    return [];
}

async function resolveUrl(debridProvider, debridApiKey, itemId, hostUrl, clientIp) {
    if (debridProvider === "DebridLink" || debridProvider === "Premiumize") {
        return hostUrl;
    } else if (debridProvider === "RealDebrid") {
        return RealDebrid.unrestrictUrl(debridApiKey, hostUrl, clientIp).catch(err => {
            console.error(`RealDebrid unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else if (debridProvider === "AllDebrid") {
        return AllDebrid.unrestrictUrl(debridApiKey, hostUrl).catch(err => {
            console.error(`AllDebrid unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else if (debridProvider === "TorBox") {
        return TorBox.unrestrictUrl(debridApiKey, itemId, hostUrl, clientIp).catch(err => {
            console.error(`TorBox unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else {
        console.error(`Invalid debridProvider for resolveUrl: ${debridProvider}`);
        return Promise.reject(BadRequestError);
    }
}

function filterSeason(torrent, season) {
    return torrent?.info?.season == season || torrent?.info?.seasons?.includes(Number(season));
}

function filterEpisode(torrentDetails, season, episode) {
    if (!torrentDetails.videos) {
        console.warn(`No videos in torrentDetails for filtering: ${torrentDetails.id}`);
        return false;
    }
    torrentDetails.videos = torrentDetails.videos
        .filter(video => (season == video.info?.season) && (episode == video.info?.episode));
    return torrentDetails.videos && torrentDetails.videos.length;
}

function filterYear(item, cinemetaDetails, itemType) {
    // Extract IMDb ID from filename if present (e.g., {imdb-tt22478818})
    const imdbMatch = item?.name?.match(/{imdb-(tt\d+)}/);
    const filenameImdbId = imdbMatch ? imdbMatch[1] : null;

    // Check for IMDb ID match first (either from info.imdb_id or filename)
    if (cinemetaDetails?.imdb_id && (item?.info?.imdb_id === cinemetaDetails.imdb_id || filenameImdbId === cinemetaDetails.imdb_id)) {
        console.log(`filterYear: IMDb ID match for ${itemType} ${item.name}, IMDb=${filenameImdbId || item.info.imdb_id}`);
        return true;
    }

    // Fallback to year matching if no IMDb ID match
    if (item?.info?.year && cinemetaDetails?.year) {
        const matches = item.info.year == cinemetaDetails.year;
        console.log(`filterYear: ${itemType}=${item.name}, ${itemType}Year=${item.info.year}, CinemetaYear=${cinemetaDetails.year}, Matches=${matches}`);
        return matches;
    }

    return true;
}

function filterDownloadEpisode(download, season, episode) {
    return download?.info?.season == season && download?.info?.episode == episode;
}

function toStream(details, type) {
    if (!details) {
        console.log('toStream: Received null details, skipping');
        return null;
    }

    let video;
    let label;
    const isDownload = (details.type === 'direct' || details.fileType === FILE_TYPES.DOWNLOADS);

    if (!details.videos || details.videos.length === 0) {
        console.log(`toStream: No videos for ${isDownload ? 'download' : 'torrent'} ${details.id}: ${details.name}`);
        video = {
            url: details.url,
            name: details.name,
            size: details.size,
            info: details.info
        };
    } else {
        video = details.videos.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    }

    label = isDownload ? '⬇️ Debrid Download' : '⬆️ User Upload';

    const title =
        `${label}\n` +
        `📦 ${formatSize(video?.size)}\n` +
        `📄 ${details.name}`;

    let name = STREAM_NAME_MAP[details.source] || details.source;
    const resolution = (video?.info?.resolution) || (details.info?.resolution) || 'Unknown';
    name = name + ' ' + resolution;

    const bingeGroup = `${details.source}|${details.id}`;

    const stream = {
        name,
        title,
        url: video?.url || '',
        behaviorHints: {
            bingeGroup
        }
    };

    console.log(`toStream: Created stream for ${details.id}: ${stream.title}`);
    return stream;
}

function formatSize(size) {
    if (!size) return 'Unknown';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = size === 0 ? 0 : Math.floor(Math.log2(size) / 10);
    const value = size / Math.pow(1024, i);
    return `${value.toFixed(2)} ${units[i]}`;
}


export default { getMovieStreams, getSeriesStreams, resolveUrl };