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

interface CaseReminderEmailProps {
  itemTitle: string;
  caseName: string;
  whenLabel: string;
  itemKind: "hearing" | "task";
  caseUrl: string;
}

export const CaseReminderEmail = ({
  itemTitle,
  caseName,
  whenLabel,
  itemKind,
  caseUrl,
}: CaseReminderEmailProps) => {
  const heading =
    itemKind === "hearing" ? "Recordatorio de audiencia/evento" : "Recordatorio de vencimiento";
  return (
    <Html lang="es" dir="ltr">
      <Head />
      <Preview>
        {itemTitle} — {caseName}
      </Preview>
      <Body style={styles.main}>
        <Section style={styles.wrapper}>
          <Container style={styles.container}>
            <Section style={styles.logoRow}>
              <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
            </Section>
            <Heading style={styles.h1}>{heading}</Heading>
            <Text style={styles.text}>
              <strong>{itemTitle}</strong>
              <br />
              Expediente: {caseName}
              <br />
              {whenLabel}
            </Text>
            <Button style={styles.button} href={caseUrl}>
              Ver expediente
            </Button>
            <Text style={styles.footer}>
              Activaste este recordatorio desde tu panel de Nyrava. Puedes desactivarlo en cualquier
              momento desde el expediente.
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
};

export default CaseReminderEmail;
