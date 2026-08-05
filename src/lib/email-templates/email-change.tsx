import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as styles from "./shared-styles";

interface EmailChangeEmailProps {
  siteName: string;
  oldEmail: string;
  email: string;
  newEmail: string;
  confirmationUrl: string;
}

export const EmailChangeEmail = ({
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Confirma el cambio de correo en {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Confirma tu nuevo correo</Heading>
          <Text style={styles.text}>
            Solicitaste cambiar la dirección de correo de {styles.siteName} de{" "}
            <Link href={`mailto:${oldEmail}`} style={styles.link}>
              {oldEmail}
            </Link>{" "}
            a{" "}
            <Link href={`mailto:${newEmail}`} style={styles.link}>
              {newEmail}
            </Link>
            .
          </Text>
          <Text style={styles.text}>Haz clic en el botón para confirmar el cambio:</Text>
          <Button style={styles.button} href={confirmationUrl}>
            Confirmar cambio
          </Button>
          <Text style={styles.footer}>
            Si no solicitaste este cambio, protege tu cuenta de inmediato.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export default EmailChangeEmail;
