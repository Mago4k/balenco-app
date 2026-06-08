const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { to, subject, html } = await req.json()

  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'Missing to, subject, or html' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Balenco <notifications@mail.balenco.app>',
      to,
      subject,
      html,
    }),
  })

  if (!sendRes.ok) {
    const errText = await sendRes.text()
    return new Response(JSON.stringify({ error: errText }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
