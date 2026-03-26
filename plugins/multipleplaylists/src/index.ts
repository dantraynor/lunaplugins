import { LunaUnload, Tracer } from "@luna/core";
import { MediaItem, redux, ContextMenu, Playlist, TidalApi } from "@luna/lib";

export const { trace, errSignal } = Tracer("[MultiplePlaylists]");

// plugin settings
export { Settings } from "./Settings";

// Functions in unloads are called when plugin is unloaded.
export const unloads = new Set<LunaUnload>();

// Local tracking of songs added to playlists (server data can be stale)
const addedSongs = new Map<string, Set<string>>(); // playlistId -> Set<songId>

// Function to show playlist selector modal
async function showPlaylistSelector(song: MediaItem) {

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create modal content
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: var(--background-color, #1a1a1a);
        border-radius: 8px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        color: var(--text-color, white);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;

    // Get song details
    const songTitle = song.title ? await song.title() : 'Unknown Song';
    let songArtist = 'Unknown Artist';
    
    // Try to get artist information
    try {
        if (song.artist) {
            const artist = await song.artist();
            if (artist && artist.name) {
                songArtist = artist.name;
            }
        } else if (song.artists) {
            const artists = await song.artists();
            if (artists && artists.length > 0) {
                // Get the first artist
                const firstArtist = await artists[0];
                if (firstArtist && firstArtist.name) {
                    songArtist = firstArtist.name;
                }
            }
        }
    } catch (error) {
        // Log artist info errors but don't fail the operation
        trace.warn("Could not get artist information:", error);
        songArtist = 'Unknown Artist';
    }

    modal.innerHTML = `
        <h2 style="margin: 0 0 16px 0; font-size: 18px;">Add to Multiple Playlists</h2>
        <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 4px;">
            <div style="font-weight: 500;">${songTitle}</div>
            <div style="font-size: 14px; opacity: 0.7;">${songArtist}</div>
        </div>
        <p style="margin: 0 0 16px 0; opacity: 0.7;">Select playlists to add this song to:</p>
        <div id="playlist-list" style="margin-bottom: 20px;"></div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancel-btn" style="
                padding: 8px 16px;
                background: transparent;
                border: 1px solid var(--border-color, #444);
                border-radius: 4px;
                color: var(--text-color, white);
                cursor: pointer;
            ">Cancel</button>
            <button id="add-btn" style="
                padding: 8px 16px;
                background: var(--primary-color, #007acc);
                border: none;
                border-radius: 4px;
                color: white;
                cursor: pointer;
            ">Add to Selected Playlists</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Populate playlist list
    populatePlaylistList(song);

    // Event listeners
    const cancelBtn = modal.querySelector('#cancel-btn');
    const addBtn = modal.querySelector('#add-btn');

    cancelBtn?.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    addBtn?.addEventListener('click', () => {
        addToSelectedPlaylists(song);
        document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

// Fetch user's playlists via Tidal API (proven approach from squadgazzz/PlaylistTools)
async function fetchUserPlaylists(): Promise<Array<{uuid: string, title: string, numberOfTracks: number}>> {
    const state = redux.store.getState();
    const userId = state.session?.userId;
    if (!userId) throw new Error("Not logged in");

    const headers = await TidalApi.getAuthHeaders();
    const queryArgs = TidalApi.queryArgs();
    const res = await fetch(
        `https://api.tidal.com/v1/users/${userId}/playlists?${queryArgs}&limit=999`,
        { headers }
    );
    if (!res.ok) throw new Error(`Failed to fetch playlists: ${res.status}`);

    const data = await res.json();
    // Only show playlists the user owns (can add songs to)
    return (data.items || [])
        .filter((p: any) => p.creator?.id === userId)
        .map((p: any) => ({
            uuid: p.uuid,
            title: p.title,
            numberOfTracks: p.numberOfTracks
        }));
}

// Fallback: load playlists from favorites store + Playlist.fromId()
async function fetchPlaylistsFromFavorites(): Promise<Array<{uuid: string, title: string, numberOfTracks: number}>> {
    const state = redux.store.getState();
    const userId = state.session?.userId;
    const favoriteUUIDs: string[] = state.favorites?.playlists || [];
    if (favoriteUUIDs.length === 0) return [];

    const results: Array<{uuid: string, title: string, numberOfTracks: number}> = [];
    for (const uuid of favoriteUUIDs) {
        try {
            const playlist = await Playlist.fromId(uuid);
            if (playlist) {
                // Only show playlists the user owns (can add songs to)
                if (userId && playlist.tidalPlaylist?.creator?.id !== userId) continue;
                results.push({
                    uuid,
                    title: await playlist.title() || 'Untitled Playlist',
                    numberOfTracks: await playlist.count() || 0
                });
            }
        } catch (error) {
            console.warn(`[MultiplePlaylists] Failed to load playlist ${uuid} from favorites:`, error);
        }
    }
    return results;
}

// Function to populate the playlist list
async function populatePlaylistList(song?: MediaItem) {
    const playlistContainer = document.querySelector('#playlist-list');
    if (!playlistContainer) return;

    try {
        // Show loading state
        playlistContainer.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">Loading playlists...</div>';

        // Try fetching playlists: API first, then favorites fallback
        let playlistsArray: Array<{uuid: string, title: string, numberOfTracks: number}> = [];
        try {
            playlistsArray = await fetchUserPlaylists();
            console.log(`[MultiplePlaylists] Loaded ${playlistsArray.length} playlists via Tidal API`);
        } catch (apiError) {
            console.warn('[MultiplePlaylists] API fetch failed, trying favorites fallback:', apiError);
            try {
                playlistsArray = await fetchPlaylistsFromFavorites();
                console.log(`[MultiplePlaylists] Loaded ${playlistsArray.length} playlists from favorites`);
            } catch (favError) {
                console.warn('[MultiplePlaylists] Favorites fallback also failed:', favError);
            }
        }

        if (playlistsArray.length === 0) {
            playlistContainer.innerHTML = '<p style="opacity: 0.7;">No playlists found. Create some playlists first!</p>';
            return;
        }

        // Process playlists in batches for duplicate detection
        const BATCH_SIZE = 5;
        const playlistBatches = [];
        for (let i = 0; i < playlistsArray.length; i += BATCH_SIZE) {
            playlistBatches.push(playlistsArray.slice(i, i + BATCH_SIZE));
        }

        // Clear container and start building the list
        playlistContainer.innerHTML = '';

        for (const [batchIndex, batch] of playlistBatches.entries()) {
            // Process batch with Promise.allSettled for fault tolerance
            const batchResults = await Promise.allSettled(
                batch.map(async (playlist) => {
                    try {
                        const isAlreadyInPlaylist = song ? await isSongInPlaylist(song, playlist.uuid) : false;
                        const statusText = isAlreadyInPlaylist ? ' (Already added)' : '';
                        const opacity = isAlreadyInPlaylist ? '0.6' : '1';

                        return `
                            <label style="
                                display: flex;
                                align-items: center;
                                padding: 8px;
                                margin-bottom: 4px;
                                cursor: pointer;
                                border-radius: 4px;
                                transition: background 0.2s;
                                opacity: ${opacity};
                            " onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="checkbox"
                                       data-playlist-id="${playlist.uuid}"
                                       style="margin-right: 12px; cursor: pointer;"
                                       ${isAlreadyInPlaylist ? 'disabled' : ''}>
                                <div>
                                    <div style="font-weight: 500;">${playlist.title || 'Untitled Playlist'}${statusText}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">${playlist.numberOfTracks || 0} tracks</div>
                                </div>
                            </label>
                        `;
                    } catch (error) {
                        console.warn(`[MultiplePlaylists] Failed to process playlist ${playlist.uuid}:`, error);
                        return `
                            <label style="
                                display: flex;
                                align-items: center;
                                padding: 8px;
                                margin-bottom: 4px;
                                cursor: pointer;
                                border-radius: 4px;
                                transition: background 0.2s;
                            " onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="checkbox"
                                       data-playlist-id="${playlist.uuid}"
                                       style="margin-right: 12px; cursor: pointer;">
                                <div>
                                    <div style="font-weight: 500;">${playlist.title || 'Untitled Playlist'}</div>
                                    <div style="font-size: 12px; opacity: 0.7;">${playlist.numberOfTracks || 0} tracks</div>
                                </div>
                            </label>
                        `;
                    }
                })
            );

            // Add results to UI immediately after each batch
            const batchHtml = batchResults
                .filter(result => result.status === 'fulfilled')
                .map(result => result.value)
                .join('');

            playlistContainer.innerHTML += batchHtml;

            // Small delay between batches to keep UI responsive
            if (batchIndex < playlistBatches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        console.log('[MultiplePlaylists] Finished processing all playlists');

    } catch (error) {
        trace.warn("Error loading playlists:", error);
        playlistContainer.innerHTML = '<p style="color: #ff6b6b;">Error loading playlists</p>';
    }
}

// Fetch all track IDs in a playlist using Luna's Playlist class
async function getPlaylistTrackIds(playlistId: string): Promise<Set<string>> {
    const trackIds = new Set<string>();
    try {
        const playlist = await Playlist.fromId(playlistId);
        if (!playlist) return trackIds;

        const items = await playlist.mediaItems();
        for await (const item of items) {
            trackIds.add(String(item.id));
        }
        console.log(`[MultiplePlaylists] Playlist ${playlistId} has ${trackIds.size} tracks`);
    } catch (error) {
        console.error(`[MultiplePlaylists] Error fetching tracks for ${playlistId}:`, error);
    }
    return trackIds;
}

// Check if a song is in a playlist — checks local tracking first, then server
async function isSongInPlaylist(mediaItem: MediaItem, playlistId: string): Promise<boolean> {
    const songIdStr = String(mediaItem.id);

    // Fast check: did we add this song in the current session?
    if (addedSongs.get(playlistId)?.has(songIdStr)) {
        console.log(`[MultiplePlaylists] Song ${songIdStr} IS in playlist ${playlistId} (local tracking)`);
        return true;
    }

    // Server check
    const trackIds = await getPlaylistTrackIds(playlistId);
    const found = trackIds.has(songIdStr);
    console.log(`[MultiplePlaylists] Song ${songIdStr} ${found ? 'IS' : 'NOT'} in playlist ${playlistId} (server)`);
    return found;
}

// Function to add song to selected playlists from the modal, and persist selection
async function addToSelectedPlaylists(song: MediaItem) {
    const checkboxes = document.querySelectorAll('#playlist-list input[type="checkbox"]:checked');
    const selectedPlaylistIds = Array.from(checkboxes).map((cb: any) => cb.dataset.playlistId).filter(Boolean);

    if (selectedPlaylistIds.length === 0) {
        showNotification('Please select at least one playlist', 'error');
        return;
    }

    try {
        const songTitle = song.title ? await song.title() : 'Unknown Song';
        let successCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        // Add to each selected playlist
        for (const playlistId of selectedPlaylistIds) {
            try {
                console.log(`[MultiplePlaylists] Processing playlist ${playlistId} for song ${song.id}`);
                
                // Check if song is already in the playlist
                const alreadyInPlaylist = await isSongInPlaylist(song, playlistId);
                
                if (alreadyInPlaylist) {
                    skippedCount++;
                    console.log(`[MultiplePlaylists] Song "${songTitle}" already in playlist, skipping`);
                    continue;
                }
                
                console.log(`[MultiplePlaylists] Adding song "${songTitle}" to playlist ${playlistId}`);

                redux.store.dispatch({
                    type: 'content/ADD_MEDIA_ITEMS_TO_PLAYLIST',
                    payload: {
                        playlistUUID: playlistId,
                        mediaItemIdsToAdd: [song.id],
                        addToIndex: -1, // Add to end
                        onDupes: "SKIP" // Server-side duplicate prevention
                    }
                });

                // Track locally so we detect it immediately next time
                if (!addedSongs.has(playlistId)) addedSongs.set(playlistId, new Set());
                addedSongs.get(playlistId)!.add(String(song.id));

                successCount++;
            } catch (error) {
                // Log per-playlist errors but continue with others
                trace.warn(`Error adding to playlist ${playlistId}:`, error);
                errorCount++;
            }
        }

        // Log results to console only (TIDAL shows its own "Added to playlist" notification)
        console.log(`[MultiplePlaylists] Results for "${songTitle}": ${successCount} added, ${errorCount} failed, ${skippedCount} skipped`);
        
        // Only show notifications for errors/warnings, let TIDAL handle success notifications
        if (errorCount > 0) {
            let message = '';
            if (skippedCount > 0) {
                message = `"${songTitle}" added to ${successCount} playlist${successCount > 1 ? 's' : ''} (${errorCount} failed, ${skippedCount} already contained this song)`;
            } else {
                message = `"${songTitle}" added to ${successCount} playlist${successCount > 1 ? 's' : ''} (${errorCount} failed)`;
            }
            showNotification(message, 'warning');
        }

    } catch (error) {
        // Log outer add errors
        trace.err("Error adding song to playlists:", error);
        showNotification('Error adding song to playlists', 'error');
    }
}

// Function to show notification
function showNotification(message: string, type: 'success' | 'warning' | 'error') {
    // Log to console with appropriate level based on type
    switch (type) {
        case 'success':
            trace.msg.log(message);
            break;
        case 'warning':
            trace.warn(message);
            break;
        case 'error':
            trace.err(message);
            break;
    }
}

// Initialize plugin
function init() {
    // Log plugin initialization
    trace.msg.log("Multiple Playlists plugin initialized");
    
    // Add context menu integration
    setupContextMenuIntegration();
}

// Setup context menu integration for "Add to Multiple Playlists"
function setupContextMenuIntegration() {
    const contextMenuButton = (ContextMenu as any).addButton(unloads);
    contextMenuButton.text = "Add to Multiple Playlists";
    
    // Store the context menu song ID for use in onClick
    let contextMenuSongId: redux.ItemId | null = null;
    let contextMenuContentType: redux.ContentType = "track";
    
    contextMenuButton.onClick(async () => {
        // Close the context menu first
        redux.store.dispatch({ type: "contextMenu/CLOSE" });
        
        // Small delay to ensure context menu is closed
        setTimeout(async () => {
            if (contextMenuSongId) {
                // Get the actual MediaItem instance for the right-clicked song
                try {
                    const mediaItem = await MediaItem.fromId(contextMenuSongId, contextMenuContentType);
                    if (mediaItem) {
                        const title = await mediaItem.title();
                        await showPlaylistSelector(mediaItem);
                    } else {
                        showNotification('Could not load song information', 'error');
                    }
                } catch (error) {
                    // Log media item load errors
                    trace.warn("Error loading song information:", error);
                    showNotification('Error loading song information', 'error');
                }
            } else {
                showNotification("No song selected", "error");
            }
        }, 100);
    });
    
    // Only show the button for media item context menus and capture the song ID
    ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
        // Store the song ID from the context menu for later use
    try {
            // Handle different types of media collections
            if (mediaCollection && typeof mediaCollection === 'object') {
                // For MediaItems collections, get the first MediaItem
                if ('mediaItems' in mediaCollection && typeof mediaCollection.mediaItems === 'function') {
                    // This is an Album or Playlist
                    const mediaItemsGenerator = await mediaCollection.mediaItems();
                    for await (const mediaItem of mediaItemsGenerator) {
                        contextMenuSongId = mediaItem.id;
                        contextMenuContentType = mediaItem.contentType;
                        break; // We only need the first one
                    }
                } else {
                    // This might be MediaItems collection - try to iterate directly
                    for await (const mediaItem of mediaCollection as unknown as Iterable<MediaItem>) {
                        contextMenuSongId = mediaItem.id;
                        contextMenuContentType = mediaItem.contentType;
                        break; // We only need the first one
                    }
                }
            }
        } catch (error) {
            // Log context menu extraction errors
            trace.warn("Error extracting media item from context menu:", error);
            contextMenuSongId = null;
        }
        
        // Show our button in the context menu
    await contextMenuButton.show(contextMenu);
    });
}

// Start the plugin
init();