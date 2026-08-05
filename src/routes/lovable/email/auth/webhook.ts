import * as React from 'react'
import { createAuthEmailHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'
import { siteName, logoUrl } from '@/lib/email-templates/shared-styles'

// Configuration
const SITE_NAME = siteName
const SENDER_DOMAIN = "notify.mexico.nyrava.com"
const ROOT_DOMAIN = "mexico.nyrava.com"
const FROM_DOMAIN = "mexico.nyrava.com"
const SITE_URL = `https://${ROOT_DOMAIN}`

interface AuthEmailData {
  email: string
  url: string
  old_email?: string
  new_email?: string
  token?: string
}

// The SDK handler owns verification, dispatch, and retry semantics; this file
// owns only the email decisions: subjects, templates, and per-type props.
const handler = createAuthEmailHandler({
  apiKey: process.env['LOVABLE_API_KEY']!,
  from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
  senderDomain: SENDER_DOMAIN,
  sendUrl: process.env['LOVABLE_SEND_URL'],
  emails: {
    signup: {
      subject: 'Confirma tu correo · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(SignupEmail, {
          siteName: SITE_NAME,
          siteUrl: SITE_URL,
          recipient: data.email,
          confirmationUrl: data.url,
        }),
    },
    invite: {
      subject: 'Tienes una invitación · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(InviteEmail, {
          siteName: SITE_NAME,
          siteUrl: SITE_URL,
          confirmationUrl: data.url,
        }),
    },
    magiclink: {
      subject: 'Tu enlace de acceso · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(MagicLinkEmail, {
          siteName: SITE_NAME,
          confirmationUrl: data.url,
        }),
    },
    recovery: {
      subject: 'Restablece tu contraseña · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(RecoveryEmail, {
          siteName: SITE_NAME,
          confirmationUrl: data.url,
        }),
    },
    email_change: {
      subject: 'Confirma tu nuevo correo · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(EmailChangeEmail, {
          siteName: SITE_NAME,
          oldEmail: data.old_email ?? '',
          email: data.email,
          newEmail: data.new_email ?? '',
          confirmationUrl: data.url,
        }),
    },
    reauthentication: {
      subject: 'Tu código de verificación · Nyrava Intelligence México',
      render: (data: AuthEmailData) =>
        React.createElement(ReauthenticationEmail, { token: data.token ?? '' }),
    },
  },
})

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
})
