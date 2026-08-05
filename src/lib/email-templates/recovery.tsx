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

interface RecoveryEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Restablece tu contraseña de {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Restablece tu contraseña</Heading>
          <Text style={styles.text}>
            Recibimos una solicitud para restablecer tu contraseña de {styles.siteName}. Haz clic en
            el botón para elegir una nueva.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Restablecer contraseña
          </Button>
          <Text style={styles.footer}>
            Si no solicitaste este cambio, ignora este mensaje. Tu contraseña no se modificará.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export default RecoveryEmail;
