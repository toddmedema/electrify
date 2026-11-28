import { utilityLogoSrc, type UtilityLogoId } from "../../data/UtilityLogos";

export default function UtilityLogoIcon({
  logo,
  className,
}: {
  logo: UtilityLogoId;
  className?: string;
}) {
  return (
    <img
      className={`utilityLogoIcon${className ? ` ${className}` : ""}`}
      src={utilityLogoSrc(logo)}
      alt=""
      draggable={false}
      data-utility-logo={logo}
    />
  );
}
