import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as styles from './shared-styles'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Tu código de verificación de {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Confirma tu identidad</Heading>
          <Text style={styles.text}>Usa el siguiente código para continuar:</Text>
          <Text style={styles.codeStyle}>{token}</Text>
          <Text style={styles.footer}>
            Este código expira en pocos minutos. Si no lo solicitaste, puedes ignorar este mensaje.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
)

export default ReauthenticationEmail
