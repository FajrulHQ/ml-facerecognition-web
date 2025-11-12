import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API_URL = process.env.REACT_APP_RECOGNITION_API_URL
const POLL_DELAY_MS = 350
const MAX_FRAME_WIDTH = 640
const MAX_FRAME_HEIGHT = 640
const JPEG_QUALITY = 0.85

const statusClasses = (code) =>
  code === 200
    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
    : 'border-sky-500 bg-sky-500/10 text-sky-300'

function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const loopRef = useRef(null)
  const abortRef = useRef(null)

  const [streamReady, setStreamReady] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [matches, setMatches] = useState([])
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
  const [lastUpdated, setLastUpdated] = useState(null)
  const [latency, setLatency] = useState(null)

  useEffect(() => {
    let mediaStream

    async function initCamera() {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
        })
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream
        }
        setStreamReady(true)
      } catch (error) {
        setFeedback(
          error?.message ||
            'Unable to access camera. Please allow camera permissions.'
        )
      }
    }

    initCamera()

    return () => {
      mediaStream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateSize = () => {
      if (!video.videoWidth || !video.videoHeight) return
      setVideoSize({
        width: video.videoWidth,
        height: video.videoHeight,
      })
    }

    video.addEventListener('loadedmetadata', updateSize)
    return () => {
      video.removeEventListener('loadedmetadata', updateSize)
    }
  }, [])

  const captureFrame = useCallback(
    () =>
      new Promise((resolve, reject) => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) {
          reject(new Error('Camera is not ready yet.'))
          return
        }
        if (!video.videoWidth || !video.videoHeight) {
          reject(new Error('Camera is warming up. Try again in a second.'))
          return
        }

        const scale = Math.min(
          1,
          MAX_FRAME_WIDTH / video.videoWidth,
          MAX_FRAME_HEIGHT / video.videoHeight
        )
        const targetWidth = Math.round(video.videoWidth * scale)
        const targetHeight = Math.round(video.videoHeight * scale)

        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Canvas context is unavailable.'))
          return
        }

        context.drawImage(video, 0, 0, targetWidth, targetHeight)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Unable to capture frame'))
              return
            }
            resolve({
              blob,
              width: canvas.width,
              height: canvas.height,
            })
          },
          'image/jpeg',
          JPEG_QUALITY
        )
      }),
    []
  )

  useEffect(() => {
    if (!isScanning) {
      if (loopRef.current) {
        clearTimeout(loopRef.current)
        loopRef.current = null
      }
      abortRef.current?.abort()
      abortRef.current = null
      setIsProcessing(false)
      return
    }

    let cancelled = false

    const runLoop = async () => {
      if (cancelled || !isScanning) return

      try {
        setIsProcessing(true)
        const { blob, width, height } = await captureFrame()
        setVideoSize({ width, height })

        const formData = new FormData()
        formData.append('file', blob, 'frame.jpg')

        const controller = new AbortController()
        abortRef.current = controller
        const startTime = performance.now()

        const response = await fetch(API_URL, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Recognition request failed with ${response.status}`)
        }

        const payload = await response.json()
        setMatches(Array.isArray(payload?.data) ? payload.data : [])
        setLatency(performance.now() - startTime)
        setLastUpdated(new Date())
        setFeedback('')
      } catch (error) {
        if (error?.name === 'AbortError') return
        setFeedback(error?.message || 'Scan failed. Please try again.')
      } finally {
        setIsProcessing(false)
        if (!cancelled && isScanning) {
          loopRef.current = setTimeout(runLoop, POLL_DELAY_MS)
        }
      }
    }

    runLoop()

    return () => {
      cancelled = true
      if (loopRef.current) {
        clearTimeout(loopRef.current)
        loopRef.current = null
      }
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [captureFrame, isScanning])

  const toggleScanning = () => {
    if (!API_URL) {
      setFeedback('Missing VITE_RECOGNITION_API_URL in your .env file.')
      return
    }
    if (!streamReady) {
      setFeedback('Camera is not ready yet.')
      return
    }
    setFeedback('')
    setIsScanning((prev) => !prev)
  }

  const boxes = useMemo(() => {
    if (!videoSize.width || !videoSize.height) return []

    return matches
      .map((match) => {
        const bounds = match?.bbox
        if (!bounds) return null

        const width = bounds.x_max - bounds.x_min
        const height = bounds.y_max - bounds.y_min

        return {
          id: match.id ?? `${bounds.x_min}-${bounds.y_min}`,
          label: match?.entity?.label,
          style: {
            left: `${(bounds.x_min / videoSize.width) * 100}%`,
            top: `${(bounds.y_min / videoSize.height) * 100}%`,
            width: `${(width / videoSize.width) * 100}%`,
            height: `${(height / videoSize.height) * 100}%`,
          },
          status_code: match.status_code,
          distance: match.distance,
        }
      })
      .filter(Boolean)
  }, [matches, videoSize.height, videoSize.width])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.4em] text-blue-400">
            Face Recognition
          </p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">
            Live bounding boxes over your camera feed
          </h1>
          <p className="max-w-3xl text-slate-300">
            Stream your webcam into the recognition service and instantly paint
            detection boxes on top of the video along with match metadata.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.45)]">
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                autoPlay
                playsInline
                muted
              />
              <div className="pointer-events-none absolute inset-0">
                {boxes.map((box) => (
                  <div
                    key={box.id}
                    className={`absolute rounded-xl border-2 p-2 text-xs font-semibold ${statusClasses(
                      box.status_code
                    )}`}
                    style={box.style}
                  >
                    <p>{box.label || 'Unknown'}</p>
                  </div>
                ))}
              </div>
              {!streamReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-sm text-slate-300">
                  <span>Requesting camera access…</span>
                </div>
              )}
              <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isScanning ? 'bg-green-400 animate-pulse' : 'bg-slate-500'
                  }`}
                />
                {isScanning ? 'Live' : 'Idle'}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={toggleScanning}
                // disabled={!streamReady || !API_URL}
                className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-lg transition disabled:cursor-not-allowed disabled:bg-slate-600 ${
                  isScanning ? 'bg-rose-500 hover:bg-rose-400' : 'bg-blue-500 hover:bg-blue-400'
                }`}
              >
                {isScanning ? 'Stop Detection' : 'Start Detection'}
              </button>
              <p className="text-xs text-slate-400">
                Posts a JPEG snapshot roughly every {(POLL_DELAY_MS / 1000).toFixed(1)}s while active.
              </p>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase text-slate-400">Status</p>
                <p className="font-semibold">
                  {isProcessing ? 'Sending frame…' : isScanning ? 'Listening' : 'Stopped'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase text-slate-400">Latency</p>
                <p className="font-semibold">
                  {latency ? `${latency.toFixed(0)} ms` : '—'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase text-slate-400">Last update</p>
                <p className="font-semibold">
                  {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>
            {feedback && (
              <p className="mt-4 rounded-2xl border border-red-500/60 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {feedback}
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white p-6 text-slate-900 shadow-[0_20px_90px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recognition log</h2>
              <span className="rounded-full bg-slate-900/10 px-3 py-1 text-xs font-semibold text-slate-500">
                {matches.length} detected
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Updated whenever the API returns new vectors.
            </p>

            <div className="mt-6 space-y-3 text-sm">
              {matches.length === 0 && (
                <p className="text-slate-400">
                  Awaiting detections. Start the stream to populate this list.
                </p>
              )}
              {matches.map((match) => (
                <article
                  key={match.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/60 bg-slate-50 px-4 py-3 text-slate-900"
                >
                  <div>
                    <p className="text-base font-semibold">
                      {match?.entity?.label || 'Unknown'}
                    </p>
                    <p className="text-xs text-slate-500">
                      ID #{match?.entity?.user_id ?? '—'} • Score:{' '}
                      {match?.distance?.toFixed(4) ?? '—'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase">
                    <span
                      className={`rounded-full px-3 py-1 ${statusClasses(match.status_code)}`}
                    >
                      Status {match.status_code ?? '—'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-white/5 bg-white/5 p-6 text-sm text-slate-200">
          <p className="font-semibold text-white">How live mode works</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-300">
            <li>Video never leaves the browser; each poll posts a single JPEG frame.</li>
            <li>Bounding boxes are re-rendered as soon as the API responds.</li>
            <li>
              Stop the loop any time to pause requests without disabling the camera
              feed.
            </li>
          </ul>
        </section>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

export default App
