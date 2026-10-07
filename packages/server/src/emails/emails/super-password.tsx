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
	Tailwind,
	Text,
} from "@react-email/components";
import { emailTailwindConfig } from "../tailwind-config";

export type SuperPasswordEmailProps = {
	title: string;
	intro: string;
	details?: { label: string; value: string }[];
	action?: { label: string; url: string };
	footer: string;
};

export const SuperPasswordEmail = ({
	title = "Super password access opened",
	intro = "Your super password was used to open access to dangerous actions.",
	details = [],
	action,
	footer = "If this wasn't you, close access and change your passwords.",
}: SuperPasswordEmailProps) => {
	return (
		<Html>
			<Head />
			<Preview>{title}</Preview>
			<Tailwind config={emailTailwindConfig}>
				<Body className="bg-[#f4f4f5] my-auto mx-auto font-sans">
					<Container className="my-[40px] mx-auto max-w-[520px]">
						<Section className="bg-[#09090b] rounded-t-xl px-[40px] py-[32px] text-center">
							<Img
								src="https://raw.githubusercontent.com/Dokploy/website/refs/heads/main/apps/docs/public/logo-dokploy-blackpng.png"
								width="190"
								height="120"
								alt="Dokploy"
								className="my-0 mx-auto"
							/>
						</Section>

						<Section className="bg-white px-[40px] py-[32px]">
							<Heading className="text-[#09090b] text-[22px] font-semibold m-0 mb-[8px]">
								{title}
							</Heading>
							<Text className="text-[#71717a] text-[14px] leading-[22px] m-0 mb-[24px]">
								{intro}
							</Text>

							{details.length > 0 && (
								<Section className="bg-[#f4f4f5] rounded-lg px-[20px] py-[12px] mb-[24px]">
									{details.map((detail) => (
										<Text
											key={detail.label}
											className="text-[#09090b] text-[13px] leading-[20px] m-0"
										>
											<strong>{detail.label}:</strong> {detail.value}
										</Text>
									))}
								</Section>
							)}

							{action && (
								<Section className="text-center mb-[8px]">
									<Button
										href={action.url}
										className="bg-[#09090b] rounded-lg text-white text-[14px] font-semibold px-[20px] py-[12px]"
									>
										{action.label}
									</Button>
								</Section>
							)}
						</Section>

						<Section className="bg-[#fafafa] rounded-b-xl px-[40px] py-[24px] text-center border-t border-solid border-[#e4e4e7]">
							<Text className="text-[#a1a1aa] text-[12px] leading-[18px] m-0">
								{footer}
							</Text>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
};

export default SuperPasswordEmail;
