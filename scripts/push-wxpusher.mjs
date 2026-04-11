const API_BASE = process.env.NEWS_API_BASE || 'https://60s.2173781196.workers.dev'
const WXPUSHER_APP_TOKEN = process.env.WXPUSHER_APP_TOKEN
const WXPUSHER_UIDS = process.env.WXPUSHER_UIDS || ''
const WXPUSHER_TOPIC_IDS = process.env.WXPUSHER_TOPIC_IDS || ''
/** 设为 1 时在正文里内嵌 <img>（部分微信/WebView 会长期缓存首图，手机端可能不刷新） */
const WXPUSHER_EMBED_IMAGE = process.env.WXPUSHER_EMBED_IMAGE === '1'

if (!WXPUSHER_APP_TOKEN) {
  throw new Error('Missing env: WXPUSHER_APP_TOKEN')
}

if (!WXPUSHER_UIDS && !WXPUSHER_TOPIC_IDS) {
  throw new Error('Missing receiver: set WXPUSHER_UIDS or WXPUSHER_TOPIC_IDS')
}

function parseCsv(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function cacheBustQuery() {
  // 绕过：① Worker 内对「当天」JSON 的内存缓存 ② 中间层对固定 URL 的缓存
  return `force-update&_=${Date.now()}`
}

async function getDailyNews() {
  const url = `${API_BASE}/v2/60s?${cacheBustQuery()}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Fetch news failed: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  if (!json?.data?.date) {
    throw new Error('Unexpected news payload')
  }
  return json.data
}

async function pushToWxPusher(content, summary) {
  const body = {
    appToken: WXPUSHER_APP_TOKEN,
    contentType: 2,
    summary,
    topicIds: parseCsv(WXPUSHER_TOPIC_IDS).map((v) => Number(v)).filter((n) => Number.isFinite(n)),
    uids: parseCsv(WXPUSHER_UIDS),
    content,
  }

  const res = await fetch('https://wxpusher.zjiecode.com/api/send/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok || data?.code !== 1000) {
    throw new Error(`WxPusher push failed: ${JSON.stringify(data)}`)
  }

  return data
}

function buildHtml(news) {
  const bust = cacheBustQuery()
  const dateText = news.day_of_week ? `${news.date} ${news.day_of_week}` : news.date
  const imageUrl = `${API_BASE}/v2/60s?encoding=image-proxy&${bust}`
  const textUrl = `${API_BASE}/v2/60s?encoding=text&${bust}`
  const sourceUrl = news.link || `${API_BASE}/v2/60s?${bust}`

  const embedImg = WXPUSHER_EMBED_IMAGE
    ? `<p><img src="${imageUrl}" alt="60s ${news.date}" referrerpolicy="no-referrer" /></p>`
    : `<p><small>若链接点开正常但缩略图不更新，是客户端缓存内嵌图导致，请点上面按钮用浏览器查看。</small></p>`

  return `
<h2>📰 每天60秒看世界（${dateText}）</h2>
<p><strong><a href="${imageUrl}">点这里打开今日图片（${news.date}）</a></strong></p>
${embedImg}
<p>${news.tip || ''}</p>
<p>
  <a href="${textUrl}">文本版</a> |
  <a href="${sourceUrl}">原文来源</a>
</p>
<p><small>图片直链（可复制到浏览器）：<br/>${imageUrl}</small></p>
`.trim()
}

async function main() {
  const news = await getDailyNews()
  const content = buildHtml(news)
  const summary = `每天60秒 · ${news.date}`
  const result = await pushToWxPusher(content, summary)

  console.log('Push success:', {
    message: result.msg,
    data: result.data,
    date: news.date,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
