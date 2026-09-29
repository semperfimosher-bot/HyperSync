import { useCallback, useEffect, useRef, useState } from "react";

import * as player from "../../audioPlayer.js";
import { apiRequest } from "../../api/client.js";
import { createJam, getCurrentJam, jamAction, joinJam, shouldApplyJamRefresh } from "../../jamSessions.js";
import { jamPlaybackAction, jamPlaybackStillWanted, shouldAdvanceJamOnEnded } from "../../jamSync.js";
import "./jamPanel.css";

const errorText = (error) => error?.detail || error?.message || "Jam is unavailable. Try again.";

export default function JamPanel({ currentUser, onOpenAuth }) {
  const [open, setOpen] = useState(false);
  const [jam, setJam] = useState(null);
  const [invite, setInvite] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(null);
  const managedTrack = useRef(null);
  const managedItem = useRef(null);
  const activeUser = useRef(null);
  const optInNow = useRef(false);
  const syncing = useRef(false);
  const joinAttempt = useRef(null);
  const userId = currentUser?.id;
  activeUser.current = userId;
  optInNow.current = optIn;
  const registered = currentUser?.account_type === "registered";
  const host = jam?.host_id === userId;

  const apply = useCallback((next) => {
    if (next && latest.current?.id === next.id && next.revision < latest.current.revision) return;
    latest.current = next;
    setJam(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!registered) return;
    try {
      const requestUserId = userId;
      const before = latest.current;
      const next = await getCurrentJam();
      if (!shouldApplyJamRefresh(requestUserId, activeUser.current, before, latest.current, next)) return;
      apply(next);
    } catch (failure) {
      // Keep the last known snapshot through a transient network outage.
      setError(errorText(failure));
    }
  }, [apply, registered, userId]);

  useEffect(() => {
    if (!registered) {
      apply(null);
      setOptIn(false);
      return undefined;
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [registered, refresh, apply]);

  useEffect(() => {
    if (managedTrack.current && player.getState().trackId === managedTrack.current) {
      player.silenceLocalPlayback();
    }
    apply(null);
    setInvite("");
    setOptIn(false);
    managedTrack.current = null;
    managedItem.current = null;
  }, [userId, apply]);

  useEffect(() => {
    const match = window.location.hash.match(/^#jam=([A-Za-z0-9_-]{40,128})$/);
    if (!registered || !match || joinAttempt.current === match[1]) return;
    joinAttempt.current = match[1];
    setOpen(true);
    setBusy(true);
    const requestUserId = userId;
    void joinJam(match[1]).then((next) => {
      if (requestUserId !== activeUser.current) return;
      apply(next);
      setError("");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }).catch((failure) => setError(errorText(failure))).finally(() => setBusy(false));
  }, [registered, apply, userId]);

  useEffect(() => {
    if (!jam || !optIn || syncing.current) return;
    const action = jamPlaybackAction(jam, {
      userId, optIn, managedTrackId: managedTrack.current, managedItemId: managedItem.current,
      local: player.getState(), nowMs: Date.now(),
    });
    if (!action) return;
    syncing.current = true;
    void (async () => {
      if (action.type === "pause") {
        await player.runWithLocalPlaybackControl(() => player.silenceLocalPlayback());
      } else if (action.type === "play") {
        const track = action.track;
        if (!track?.id) return;
        await player.runWithLocalPlaybackControl(() => player.playTrack(track.id, track));
        if (player.getState().trackId !== track.id) return;
        if (!jamPlaybackStillWanted(latest.current, { userId,
          activeUserId: activeUser.current, jamId: jam.id,
          itemId: jam.current_item_id, optIn: optInNow.current })) {
          if (player.getState().trackId === track.id) player.silenceLocalPlayback();
          return;
        }
        managedTrack.current = track.id;
        managedItem.current = jam.current_item_id;
        await player.runWithLocalPlaybackControl(() => player.seekTo(action.position));
      } else if (action.type === "resume") {
        await player.runWithLocalPlaybackControl(() => player.seekTo(action.position));
        await player.runWithLocalPlaybackControl(() => player.togglePlay());
      } else if (action.type === "seek") {
        await player.runWithLocalPlaybackControl(() => player.seekTo(action.position));
      }
    })().catch((failure) => setError(errorText(failure))).finally(() => { syncing.current = false; });
  }, [jam, optIn, userId]);

  useEffect(() => {
    if (!jam && managedTrack.current) {
      if (player.getState().trackId === managedTrack.current) {
        player.silenceLocalPlayback();
      }
      managedTrack.current = null;
      managedItem.current = null;
      setOptIn(false);
    }
  }, [jam]);

  useEffect(() => {
    player.setJamTrackEndedController((trackId) => {
      const current = latest.current;
      if (!optIn || !current || managedTrack.current !== trackId
        || current.current_track_id !== trackId) return false;
      if (managedItem.current !== current.current_item_id) return true;
      if (shouldAdvanceJamOnEnded(current, { userId: activeUser.current, trackId,
        managedTrackId: managedTrack.current, managedItemId: managedItem.current, optIn })) {
        void jamAction(current, "/playback", { action: "next" }).then(apply).catch((failure) => {
          if (failure?.status === 409) void refresh();
          else setError(errorText(failure));
        });
      }
      return true;
    });
    return () => player.setJamTrackEndedController(null);
  }, [optIn, apply, refresh]);

  async function run(task) {
    if (busy) return;
    const requestUserId = userId;
    setBusy(true);
    setError("");
    try { const next = await task(); if (requestUserId === activeUser.current) apply(next); }
    catch (failure) {
      if (requestUserId !== activeUser.current) return;
      setError(errorText(failure));
      if (failure?.status === 409) await refresh();
    } finally { setBusy(false); }
  }

  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    try {
      setResults(await apiRequest(`/catalog/tracks?q=${encodeURIComponent(query.trim())}`));
    } catch (failure) { setError(errorText(failure)); }
  }

  const mutate = (path, body, method) => jamAction(latest.current, path, body, method);
  const canControl = host || jam?.allow_guest_control;
  const shareUrl = invite ? `${window.location.origin}${window.location.pathname}#jam=${invite}` : "";
  const moveQueueItem = (index, direction) => {
    const itemIds = jam.queue.map((entry) => entry.id);
    [itemIds[index], itemIds[index + direction]] = [itemIds[index + direction], itemIds[index]];
    void run(() => mutate("/queue/reorder", { item_ids: itemIds }));
  };

  return (
    <div className="jam-control">
      <button type="button" className="jam-trigger" aria-expanded={open}
        onClick={() => {
          if (!registered) { onOpenAuth?.(); return; }
          setOpen(!open);
        }}>
        {jam ? "Jam · Live" : "Start a Jam"}
      </button>
      {open && registered ? (
        <section className="jam-panel" aria-label="Jam session">
          <header><strong>{jam ? "Your Jam" : "Listen together"}</strong>
            <button type="button" aria-label="Close Jam panel" onClick={() => setOpen(false)}>×</button>
          </header>
          {error ? <p role="alert" className="jam-error">{error}</p> : null}
          {!jam ? <>
            <p>Build a queue together. Choose where the sound plays.</p>
            <div className="jam-actions">
              <button disabled={busy} onClick={() => void run(async () => { const next = await createJam("host"); setInvite(next.invite_code); return next; })}>Play on my device</button>
              <button disabled={busy} onClick={() => void run(async () => { const next = await createJam("everyone"); setInvite(next.invite_code); return next; })}>Play on every device</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void run(() => joinJam(joinCode.trim())); }}>
              <label htmlFor="jam-code">Join with an invite code</label>
              <div className="jam-actions"><input id="jam-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} minLength={40} required />
                <button disabled={busy}>Join</button></div>
            </form>
          </> : <>
            <p>{jam.mode === "everyone" ? "Everyone can listen on their own device." : "Music plays on the host device."}</p>
            <p className="jam-current">{jam.current_track ? `${jam.current_track.title} · ${jam.current_track.artist}` : "Add a track to get started."}</p>
            {host && jam.current_track && !jam.current_track.duration_seconds ? <p>
              This track has no saved length. Keep listening on the host device, enable guest controls,
              or use Next when it ends.
            </p> : null}
            {((host || jam.mode === "everyone") && !optIn) ? (
              <button disabled={busy} onClick={() => setOptIn(true)}>Listen on this device</button>
            ) : optIn ? <button onClick={() => { setOptIn(false); if (managedTrack.current && player.getState().trackId === managedTrack.current) player.silenceLocalPlayback(); }}>Stop listening here</button> : null}
            {canControl ? <div className="jam-actions">
              <button disabled={busy} onClick={() => void run(() => mutate("/playback", { action: jam.paused ? "play" : "pause" }))}>{jam.paused ? "Play" : "Pause"}</button>
              <button disabled={busy} onClick={() => void run(() => mutate("/playback", { action: "next" }))}>Next</button>
            </div> : null}
            {host ? <div className="jam-settings">
              <label>Playback location <select value={jam.mode} disabled={busy} onChange={(event) => void run(() => mutate("/mode", { mode: event.target.value }))}>
                <option value="host">Host device</option><option value="everyone">Every device</option>
              </select></label>
              <label><input type="checkbox" checked={jam.allow_guest_control} disabled={busy} onChange={(event) => void run(() => mutate("/permissions", { allow_guest_control: event.target.checked }))} /> Guests can play, pause and skip</label>
              <button disabled={busy} onClick={() => void run(async () => { const next = await mutate("/invite", {}); setInvite(next.invite_code); return next; })}>New invite link</button>
              {shareUrl ? <button onClick={() => void navigator.clipboard.writeText(shareUrl).catch((failure) => setError(errorText(failure)))}>Copy invite link</button> : null}
            </div> : null}
            <div className="jam-members"><strong>Listening together</strong><ul>{jam.members.map((member) => <li key={member.user_id}>
              {member.username || "Member"}{member.user_id === jam.host_id ? " · Host" : ""}
              {host && member.user_id !== userId ? <button disabled={busy} aria-label={`Remove ${member.username}`} onClick={() => void run(() => mutate(`/members/${member.user_id}`, {}, "DELETE"))}>Remove</button> : null}
            </li>)}</ul></div>
            <form onSubmit={(event) => void search(event)}><label htmlFor="jam-search">Add a catalog track</label>
              <div className="jam-actions"><input id="jam-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks" />
                <button>Search</button></div></form>
            {results.length ? <ul className="jam-results">{results.slice(0, 12).map((track) => <li key={track.id}>{track.title} · {track.artist}
              <button disabled={busy} aria-label={`Add ${track.title}`} onClick={() => void run(() => mutate("/queue", { track_id: track.id }))}>Add</button></li>)}</ul> : null}
            <strong>Up next</strong><ol className="jam-queue">{jam.queue.map((entry, index) => <li key={entry.id}>{entry.track.title} · {entry.track.artist}
              {host ? <>
                <button disabled={busy || index === 0} aria-label={`Move ${entry.track.title} up`} onClick={() => moveQueueItem(index, -1)}>↑</button>
                <button disabled={busy || index === jam.queue.length - 1} aria-label={`Move ${entry.track.title} down`} onClick={() => moveQueueItem(index, 1)}>↓</button>
                <button disabled={busy} aria-label={`Remove ${entry.track.title}`} onClick={() => void run(() => mutate(`/queue/${entry.id}`, {}, "DELETE"))}>Remove</button>
              </> : null}</li>)}</ol>
            <button className="jam-exit" disabled={busy} onClick={() => void run(async () => { await mutate(host ? "/end" : "/leave", {}); setInvite(""); setOptIn(false); return null; })}>{host ? "End Jam" : "Leave Jam"}</button>
          </>}
        </section>
      ) : null}
    </div>
  );
}
