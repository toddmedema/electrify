/** Paint the frost cover on the terrain face, under the water and any standing structures. */
export default function FrostGround({ fill }: { fill?: string }) {
  return fill ? (
    <path d="M250 0 500 125V375L250 500 0 375V125Z" fill={fill} />
  ) : null;
}

export function FrostGroundPatterns({ id }: { id: string }) {
  return (
    <>
      <pattern id={id} patternUnits="userSpaceOnUse" width="267" height="223">
        <path
          d="m8 31 17-11 12 5 9-10 18 1 8 10 18-4 12 14-7 13-19 2-13 13-16-7-14 8-23-11zm137 54 16-11 12 6 11-13 16 5 9 11 21-6 16 16-8 11-19 1-7 13-19-5-9 6-11-10-24 1zm-110 86 12-15 13 2 7-14 26 2 13 12 19-4 15 12-8 13-15 2-11 13-21-9-17 6-11-8-11 3zm155 20 17-15 14 8 12-13 15 10 14-2 3 17-17 10-19-1-12 9-21-13z"
          fill="#eff8fc"
          opacity=".5"
        />
        <path
          d="m25 28 10-2 7 7-5 6-13-2zm43 15 9-6 11 8-10 8zM102 58l12 2 3 6-13 5-5-5zm54 35 8-9 7 6-2 10-12 2zm44-12 13 8-4 9-15-2-4-8zM229 120l9-3 5 4-3 9-9-3zM56 165l9-7 10 4 2 7-13 6zm33-11 13 2 2 7-12 3zm19 23 12-4 9 5-9 8-10-2zm44-3 8-6 7 4-3 8-10 1zm53 18 9-5 12 5-8 10-11-3zm35-5 8-4 7 8-6 6-10-1z"
          fill="#f7fcff"
          opacity=".85"
        />
      </pattern>
      <pattern
        id={`${id}-offset`}
        href={`#${id}`}
        patternTransform="translate(101 57) scale(-1 1)"
      />
    </>
  );
}
