import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as styles from "./shared-styles";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Tu enlace de acceso a {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Tu enlace de acceso</Heading>
          <Text style={styles.text}>
            Haz clic en el botón para iniciar sesión en {styles.siteName}. Este enlace expira en
            pocos minutos.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Iniciar sesión
          </Button>
          <Text style={styles.footer}>
            Si no solicitaste este enlace, puedes ignorar este mensaje.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export default MagicLinkEmail;
