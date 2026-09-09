// Generated from the five researched transmission reports for issue #61.
// Gameplay values are calibrated abstractions; route status and descriptions preserve the cited research.

export type AdjacentMarketTuple = readonly [
  string,
  string,
  string,
  number,
  number,
  number,
];
export type TransmissionCorridorTuple = readonly [
  string,
  string,
  string,
  "EXISTING" | "NEW",
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type TransmissionProfileTuple = readonly [
  readonly AdjacentMarketTuple[],
  readonly TransmissionCorridorTuple[],
];

// prettier-ignore
export const TRANSMISSION_PROFILE_DATA = {
  "us-ca-wecc": [
    [
      ["pacific-northwest","Pacific Northwest","Hydropower often makes imports affordable, but dry years can tighten supply.",48,1800000000,1400000000],
      ["desert-southwest","Desert Southwest","Midday solar can be cheap; hot evenings raise both demand and prices.",55,1500000000,1700000000]
    ],
    [
      ["california-north","pacific-northwest","Northern intertie upgrade","EXISTING",500000000,180000000,3600000,1,30,0.012,0.04],
      ["california-south","desert-southwest","Desert connection","NEW",750000000,420000000,7200000,3,32,0.015,0.06]
    ]
  ],
  "us-pjm": [
    [
      ["pjm-miso-upgrade-market","Midcontinent market","A wide neighboring market can share wind, thermal, and hydro power across the western seam.",45,2200000000,2100000000],
      ["pjm-nyiso-new-market","New York market","A stronger northeastern path can trade city demand and upstate hydro, but congestion can make power expensive.",58,1300000000,1600000000]
    ],
    [
      ["pjm-miso-upgrade","pjm-miso-upgrade-market","Midcontinent market upgrade","EXISTING",600000000,240000000,4800000,2,31,0.012,0.04],
      ["pjm-nyiso-new","pjm-nyiso-new-market","New York market connection","NEW",800000000,640000000,9600000,4,30,0.012,0.04]
    ]
  ],
  "us-nyiso": [
    [
      ["ny-quebec-upgrade-market","Québec hydro market","Reservoir hydropower can answer quickly when New York needs energy.",42,2200000000,900000000],
      ["ny-pjm-new-market","PJM market","A new controlled path links two large city-heavy markets, where peak prices often arrive together.",54,1800000000,2000000000]
    ],
    [
      ["ny-quebec-upgrade","ny-quebec-upgrade-market","Québec hydro market upgrade","EXISTING",700000000,350000000,5600000,2,29,0.01,0.03],
      ["ny-pjm-new","ny-pjm-new-market","PJM market connection","NEW",750000000,675000000,10100000,4,30,0.012,0.04]
    ]
  ],
  "us-isone": [
    [
      ["newengland-quebec-upgrade-market","Québec hydro market","Stored water can supply steady power during cold snaps and summer peaks.",43,2100000000,800000000],
      ["newengland-newyork-new-market","New York market","A stronger westward link adds another path when local gas or transmission is constrained.",57,1200000000,1500000000]
    ],
    [
      ["newengland-quebec-upgrade","newengland-quebec-upgrade-market","Québec hydro market upgrade","EXISTING",700000000,315000000,5600000,2,28,0.01,0.03],
      ["newengland-newyork-new","newengland-newyork-new-market","New York market connection","NEW",500000000,500000000,8000000,4,29,0.011,0.03]
    ]
  ],
  "us-miso-north": [
    [
      ["miso-pjm-upgrade-market","PJM market","Upgrading the busy eastern seam lets two huge markets help each other when local plants are tight.",49,2200000000,2300000000],
      ["miso-spp-new-market","Great Plains market","Plains wind can be abundant, while heat waves can make both regions compete for power.",41,2000000000,1500000000]
    ],
    [
      ["miso-pjm-upgrade","miso-pjm-upgrade-market","PJM market upgrade","EXISTING",700000000,260000000,5200000,2,31,0.012,0.04],
      ["miso-spp-new","miso-spp-new-market","Great Plains market connection","NEW",800000000,560000000,8400000,4,32,0.013,0.04]
    ]
  ],
  "us-miso-south": [
    [
      ["miso-south-spp-upgrade-market","Southwest Power Pool","A western seam shares wind and gas power with the Gulf region.",44,1600000000,1500000000],
      ["miso-south-southeast-new-market","Southeastern utilities","A new eastward route adds support during hurricanes and hot, still evenings.",51,1500000000,1800000000]
    ],
    [
      ["miso-south-spp-upgrade","miso-south-spp-upgrade-market","Southwest Power Pool upgrade","EXISTING",500000000,220000000,4400000,2,32,0.014,0.05],
      ["miso-south-southeast-new","miso-south-southeast-new-market","Southeastern utilities connection","NEW",600000000,510000000,7600000,4,32,0.015,0.05]
    ]
  ],
  "us-spp": [
    [
      ["spp-miso-upgrade-market","Midcontinent market","A stronger eastern seam makes more Plains wind useful across a much larger region.",43,2100000000,1900000000],
      ["spp-west-hvdc-new-market","Rocky Mountain grid","Converter stations let two grids trade without forcing their electrical rhythms to match.",46,1400000000,1300000000]
    ],
    [
      ["spp-miso-upgrade","spp-miso-upgrade-market","Midcontinent market upgrade","EXISTING",700000000,245000000,4900000,2,32,0.013,0.04],
      ["spp-west-hvdc-new","spp-west-hvdc-new-market","Rocky Mountain grid connection","NEW",600000000,720000000,10800000,5,31,0.012,0.05]
    ]
  ],
  "us-tva": [
    [
      ["tva-pjm-upgrade-market","PJM market","A northern connection can supply power during a Valley shortage or buy surplus local energy.",50,1800000000,1900000000],
      ["tva-midcontinent-new-market","Midcontinent market","A new Mississippi crossing opens a second regional path for trading and emergency help.",45,1700000000,1600000000]
    ],
    [
      ["tva-pjm-upgrade","tva-pjm-upgrade-market","PJM market upgrade","EXISTING",500000000,210000000,4200000,2,31,0.013,0.04],
      ["tva-midcontinent-new","tva-midcontinent-new-market","Midcontinent market connection","NEW",650000000,520000000,7800000,4,32,0.014,0.05]
    ]
  ],
  "us-carolinas": [
    [
      ["carolinas-pjm-upgrade-market","PJM market","A stronger northern seam brings access to a large multi-state market.",51,1700000000,1800000000],
      ["carolinas-southeast-new-market","Southern utility pool","A second route shares solar and gas power across the Southeast.",49,1500000000,1600000000]
    ],
    [
      ["carolinas-pjm-upgrade","carolinas-pjm-upgrade-market","PJM market upgrade","EXISTING",500000000,225000000,4500000,2,31,0.013,0.04],
      ["carolinas-southeast-new","carolinas-southeast-new-market","Southern utility pool connection","NEW",500000000,425000000,6400000,4,32,0.014,0.05]
    ]
  ],
  "us-southeast": [
    [
      ["southeast-tva-upgrade-market","Tennessee Valley","An existing northern path can share nuclear, hydro, gas, and solar generation.",48,1600000000,1600000000],
      ["southeast-miso-new-market","Lower Mississippi market","A new westward line adds choices when a storm or heat wave strains one side.",47,1700000000,1700000000]
    ],
    [
      ["southeast-tva-upgrade","southeast-tva-upgrade-market","Tennessee Valley upgrade","EXISTING",500000000,205000000,4100000,2,32,0.014,0.05],
      ["southeast-miso-new","southeast-miso-new-market","Lower Mississippi market connection","NEW",650000000,550000000,8300000,4,32,0.015,0.05]
    ]
  ],
  "us-florida": [
    [
      ["florida-southeast-upgrade-market","Southeastern grid","Florida's main outside support comes from the north, so this upgrade adds room on an already important path.",50,1800000000,1900000000],
      ["florida-gulf-new-market","Gulf Coast market","A new controlled Gulf route gives Florida another source when the northern path is crowded.",52,1500000000,1800000000]
    ],
    [
      ["florida-southeast-upgrade","florida-southeast-upgrade-market","Southeastern grid upgrade","EXISTING",600000000,260000000,5200000,2,32,0.015,0.06],
      ["florida-gulf-new","florida-gulf-new-market","Gulf Coast market connection","NEW",700000000,910000000,13700000,5,32,0.015,0.06]
    ]
  ],
  "us-ercot": [
    [
      ["ercot-east-dc-upgrade-market","Eastern grid","DC converter stations let Texas trade while its AC grid keeps operating independently.",47,1600000000,1700000000],
      ["ercot-southern-spirit-new-market","Southeastern grid","A major new DC line can move much more emergency and market power across the Texas seam.",51,2200000000,2200000000]
    ],
    [
      ["ercot-east-dc-upgrade","ercot-east-dc-upgrade-market","Eastern grid upgrade","EXISTING",600000000,360000000,7200000,2,33,0.016,0.06],
      ["ercot-southern-spirit-new","ercot-southern-spirit-new-market","Southeastern grid connection","NEW",1200000000,1500000000,22500000,6,33,0.016,0.06]
    ]
  ],
  "us-pnw-wecc": [
    [
      ["pnw-california-upgrade-market","California market","A long north-south path trades hydropower, solar power, and evening demand.",56,1700000000,2100000000],
      ["pnw-bc-upgrade-market","British Columbia hydro","Northern reservoirs can trade across the border when water and demand differ.",44,1500000000,900000000]
    ],
    [
      ["pnw-california-upgrade","pnw-california-upgrade-market","California market upgrade","EXISTING",700000000,245000000,4900000,2,30,0.011,0.04],
      ["pnw-bc-upgrade","pnw-bc-upgrade-market","British Columbia hydro upgrade","EXISTING",400000000,160000000,3200000,2,28,0.01,0.03]
    ]
  ],
  "us-desert-wecc": [
    [
      ["desert-california-upgrade-market","California market","Desert solar can flow west by day, while California can help after sunset.",55,1500000000,1900000000],
      ["desert-rockies-new-market","Rocky Mountain grid","A new inland route reaches wind and flexible generation with a different weather pattern.",45,1500000000,1300000000]
    ],
    [
      ["desert-california-upgrade","desert-california-upgrade-market","California market upgrade","EXISTING",600000000,230000000,4600000,2,34,0.017,0.07],
      ["desert-rockies-new","desert-rockies-new-market","Rocky Mountain grid connection","NEW",700000000,595000000,8900000,4,33,0.015,0.06]
    ]
  ],
  "us-rockies-wecc": [
    [
      ["rockies-desert-upgrade-market","Desert Southwest","This route trades mountain wind and hydro for desert solar and peak support.",48,1500000000,1500000000],
      ["rockies-eastern-hvdc-new-market","Great Plains market","A new HVDC seam link lets the Western and Eastern grids exchange much more power safely.",42,1800000000,1500000000]
    ],
    [
      ["rockies-desert-upgrade","rockies-desert-upgrade-market","Desert Southwest upgrade","EXISTING",500000000,210000000,4200000,2,31,0.012,0.05],
      ["rockies-eastern-hvdc-new","rockies-eastern-hvdc-new-market","Great Plains market connection","NEW",750000000,900000000,13500000,5,31,0.012,0.05]
    ]
  ],
  "ca-ontario": [
    [
      ["ontario-quebec-upgrade-market","Québec hydro market","Flexible reservoir power complements Ontario's nuclear-heavy supply.",42,2000000000,1000000000],
      ["ontario-us-upgrade-market","Great Lakes U.S. market","Several border paths link Ontario to New York and Midcontinent neighbors.",50,1700000000,1900000000]
    ],
    [
      ["ontario-quebec-upgrade","ontario-quebec-upgrade-market","Québec hydro market upgrade","EXISTING",700000000,280000000,5600000,2,29,0.01,0.03],
      ["ontario-us-upgrade","ontario-us-upgrade-market","Great Lakes U.S. market upgrade","EXISTING",600000000,270000000,5400000,2,30,0.011,0.03]
    ]
  ],
  "ca-quebec": [
    [
      ["quebec-ontario-upgrade-market","Ontario market","Ontario can buy flexible hydro or sell steady nuclear power when Québec reservoirs are tight.",49,1700000000,1800000000],
      ["quebec-northeast-upgrade-market","New York and New England","Controlled ties carry Québec hydro to large northeastern markets.",56,1500000000,2300000000]
    ],
    [
      ["quebec-ontario-upgrade","quebec-ontario-upgrade-market","Ontario market upgrade","EXISTING",700000000,280000000,5600000,2,29,0.01,0.03],
      ["quebec-northeast-upgrade","quebec-northeast-upgrade-market","New York and New England upgrade","EXISTING",900000000,405000000,7200000,2,29,0.01,0.03]
    ]
  ],
  "ca-bc": [
    [
      ["bc-pnw-upgrade-market","Pacific Northwest","Hydro systems on both sides of the border can trade when rainfall, snowmelt, and demand differ.",47,1700000000,1400000000],
      ["bc-alberta-upgrade-market","Alberta market","A mountain crossing trades flexible hydro for wind and gas power.",50,1300000000,1400000000]
    ],
    [
      ["bc-pnw-upgrade","bc-pnw-upgrade-market","Pacific Northwest upgrade","EXISTING",600000000,230000000,4600000,2,28,0.01,0.03],
      ["bc-alberta-upgrade","bc-alberta-upgrade-market","Alberta market upgrade","EXISTING",400000000,190000000,3800000,2,28,0.01,0.03]
    ]
  ],
  "ca-alberta": [
    [
      ["alberta-bc-upgrade-market","British Columbia hydro","Reservoir power can balance Alberta's wind and demand swings.",45,1500000000,1000000000],
      ["alberta-saskatchewan-new-market","Prairie eastern grid","A larger converter link reaches a grid that runs independently from the West.",47,900000000,900000000]
    ],
    [
      ["alberta-bc-upgrade","alberta-bc-upgrade-market","British Columbia hydro upgrade","EXISTING",500000000,220000000,4400000,2,29,0.01,0.03],
      ["alberta-saskatchewan-new","alberta-saskatchewan-new-market","Prairie eastern grid connection","NEW",300000000,390000000,5900000,4,30,0.011,0.03]
    ]
  ],
  "ca-manitoba": [
    [
      ["manitoba-us-upgrade-market","U.S. Midcontinent","Large north-south lines trade Manitoba hydro with the Midwest.",46,1700000000,1800000000],
      ["manitoba-saskatchewan-upgrade-market","Saskatchewan market","A prairie link shares hydro, wind, and thermal power across different peak conditions.",48,900000000,900000000]
    ],
    [
      ["manitoba-us-upgrade","manitoba-us-upgrade-market","U.S. Midcontinent upgrade","EXISTING",700000000,280000000,5600000,2,29,0.01,0.03],
      ["manitoba-saskatchewan-upgrade","manitoba-saskatchewan-upgrade-market","Saskatchewan market upgrade","EXISTING",300000000,135000000,2700000,2,30,0.011,0.03]
    ]
  ],
  "ca-maritimes": [
    [
      ["novascotia-newbrunswick-upgrade-market","New Brunswick market","This is Nova Scotia's landward path to the wider Eastern grid.",51,900000000,1000000000],
      ["novascotia-maritime-link-upgrade-market","Newfoundland hydro","A subsea cable brings renewable power across the Cabot Strait.",44,1100000000,700000000]
    ],
    [
      ["novascotia-newbrunswick-upgrade","novascotia-newbrunswick-upgrade-market","New Brunswick market upgrade","EXISTING",350000000,160000000,3200000,2,27,0.009,0.03],
      ["novascotia-maritime-link-upgrade","novascotia-maritime-link-upgrade-market","Newfoundland hydro upgrade","EXISTING",475000000,285000000,5700000,2,27,0.009,0.02]
    ]
  ],
  "mx-sin-central-west": [
    [
      ["mexico-central-occidental-upgrade-market","Western Mexico","A stronger central-west path shares solar, hydro, geothermal, and city demand inside the national market.",53,1800000000,2000000000],
      ["mexico-northeast-new-market","Northeast Mexico","A new long-distance line reaches industrial demand and gas generation in the northeast.",50,1900000000,2100000000]
    ],
    [
      ["mexico-central-occidental-upgrade","mexico-central-occidental-upgrade-market","Western Mexico upgrade","EXISTING",700000000,245000000,4900000,2,31,0.013,0.05],
      ["mexico-northeast-new","mexico-northeast-new-market","Northeast Mexico connection","NEW",800000000,760000000,11400000,5,33,0.015,0.06]
    ]
  ],
  "mx-sin-northeast": [
    [
      ["monterrey-ercot-dc-upgrade-market","Texas market","Converters let Northeast Mexico and Texas trade without synchronizing their whole grids.",48,1000000000,1100000000],
      ["monterrey-central-mexico-upgrade-market","Central Mexico","A stronger inland backbone links industrial demand with the national generation mix.",53,1700000000,1900000000]
    ],
    [
      ["monterrey-ercot-dc-upgrade","monterrey-ercot-dc-upgrade-market","Texas market upgrade","EXISTING",300000000,195000000,3900000,2,34,0.016,0.06],
      ["monterrey-central-mexico-upgrade","monterrey-central-mexico-upgrade-market","Central Mexico upgrade","EXISTING",600000000,250000000,5000000,2,33,0.015,0.05]
    ]
  ],
  "mx-baja-wecc": [
    [
      ["tijuana-california-upgrade-market","Southern California","Two operating border paths let Baja California and California support each other.",57,1500000000,1900000000],
      ["baja-sin-hvdc-new-market","Mexican national grid","A new HVDC line would connect Baja to the SIN without forcing the two AC systems to synchronize.",52,1900000000,1800000000]
    ],
    [
      ["tijuana-california-upgrade","tijuana-california-upgrade-market","Southern California upgrade","EXISTING",600000000,210000000,4200000,2,32,0.014,0.06],
      ["baja-sin-hvdc-new","baja-sin-hvdc-new-market","Mexican national grid connection","NEW",800000000,1040000000,15600000,6,33,0.015,0.06]
    ]
  ],
  "mx-sin-yucatan": [
    [
      ["yucatan-sin-upgrade-market","Eastern Mexico","The peninsula's main connection carries power to and from the rest of Mexico.",52,1700000000,1800000000],
      ["yucatan-belize-upgrade-market","Belize grid","A small border line offers useful emergency trade, but cannot power the whole peninsula.",59,120000000,140000000]
    ],
    [
      ["yucatan-sin-upgrade","yucatan-sin-upgrade-market","Eastern Mexico upgrade","EXISTING",600000000,270000000,5400000,2,32,0.015,0.06],
      ["yucatan-belize-upgrade","yucatan-belize-upgrade-market","Belize grid upgrade","EXISTING",50000000,35000000,700000,1,32,0.015,0.06]
    ]
  ],
  "siepac-north": [
    [
      ["siepac-north-neighbor-upgrade-market","Neighboring SIEPAC market","The regional line trades power with the next country when rainfall, wind, or demand differs.",61,650000000,700000000],
      ["guatemala-mexico-upgrade-market","Mexico market","A northern border line gives the regional market another source and buyer.",54,900000000,1000000000]
    ],
    [
      ["siepac-north-neighbor-upgrade","siepac-north-neighbor-upgrade-market","Neighboring SIEPAC market upgrade","EXISTING",250000000,105000000,2100000,2,31,0.014,0.05],
      ["guatemala-mexico-upgrade","guatemala-mexico-upgrade-market","Mexico market upgrade","EXISTING",240000000,110000000,2200000,2,32,0.014,0.05]
    ]
  ],
  "siepac-central": [
    [
      ["siepac-central-north-upgrade-market","Northern SIEPAC market","Trade north toward Guatemala and El Salvador when their power is cheaper.",60,650000000,700000000],
      ["siepac-central-south-upgrade-market","Southern SIEPAC market","Trade south toward Costa Rica and Panama, where rainfall and generation can follow a different pattern.",57,750000000,750000000]
    ],
    [
      ["siepac-central-north-upgrade","siepac-central-north-upgrade-market","Northern SIEPAC market upgrade","EXISTING",250000000,100000000,2000000,2,32,0.014,0.05],
      ["siepac-central-south-upgrade","siepac-central-south-upgrade-market","Southern SIEPAC market upgrade","EXISTING",300000000,120000000,2400000,2,32,0.014,0.05]
    ]
  ],
  "siepac-south": [
    [
      ["siepac-south-north-upgrade-market","Northern SIEPAC market","The regional backbone reaches five neighboring national markets to the north.",59,800000000,800000000],
      ["panama-colombia-hvdc-new-market","Colombia market","A planned HVDC line would join Central and South America's regional grids.",48,1000000000,900000000]
    ],
    [
      ["siepac-south-north-upgrade","siepac-south-north-upgrade-market","Northern SIEPAC market upgrade","EXISTING",300000000,120000000,2400000,2,31,0.014,0.05],
      ["panama-colombia-hvdc-new","panama-colombia-hvdc-new-market","Colombia market connection","NEW",400000000,800000000,12000000,6,32,0.015,0.05]
    ]
  ],
  "siepac-san-salvador": [
    [
      ["siepac-honduras-market","Neighboring SIEPAC market","The regional line trades power with the next country when rainfall, wind, or demand differs.",61,650000000,700000000]
    ],
    [
      ["siepac-honduras-upgrade","siepac-honduras-market","Honduras intertie upgrade","EXISTING",250000000,105000000,2100000,2,31,0.014,0.05]
    ]
  ],
  "siepac-costa-rica": [
    [
      ["siepac-panama-market","Northern SIEPAC market","The regional backbone reaches five neighboring national markets to the north.",59,800000000,800000000]
    ],
    [
      ["siepac-panama-upgrade","siepac-panama-market","Panama intertie upgrade","EXISTING",300000000,120000000,2400000,2,31,0.014,0.05]
    ]
  ],
  "geo-london": [
    [
      ["geo-london-continental-core","Continental Europe","Nuclear, wind, and gas compete across the Channel; prices change when cables or power stations are busy.",62,2400000000,2200000000],
      ["geo-london-norwegian-hydro","Norwegian hydropower","Reservoirs can send flexible low-carbon power, but dry years leave less to export.",49,1600000000,1200000000]
    ],
    [
      ["gb-channel-upgrade","geo-london-continental-core","Channel cable upgrade","EXISTING",750000000,240000000,4800000,1,30,0.012,0.03],
      ["gb-north-sea-upgrade","geo-london-norwegian-hydro","North Sea Link upgrade","EXISTING",500000000,260000000,5200000,2,27,0.01,0.02]
    ]
  ],
  "geo-dublin": [
    [
      ["geo-dublin-great-britain-market","Great Britain","Windy hours can be cheap, while cold calm evenings can tighten supply.",64,1400000000,1600000000],
      ["geo-dublin-continental-core","Continental Europe","A larger mix of nuclear, wind, hydro, and gas gives another source of power.",62,1500000000,1400000000]
    ],
    [
      ["ireland-ewic-upgrade","geo-dublin-great-britain-market","Irish Sea cable upgrade","EXISTING",350000000,190000000,3800000,1,27,0.01,0.02],
      ["ireland-celtic","geo-dublin-continental-core","Celtic Interconnector","NEW",700000000,620000000,10500000,4,28,0.01,0.02]
    ]
  ],
  "geo-paris": [
    [
      ["geo-paris-continental-core","Core European market","Neighbouring grids share wind, solar, nuclear, hydro, and gas across many borders.",60,2800000000,2600000000],
      ["geo-paris-iberian-market","Iberian renewables","Spanish and Portuguese wind, sun, and hydro can send surplus north, but the Pyrenees limit the flow.",51,1700000000,1400000000]
    ],
    [
      ["france-core-upgrade","geo-paris-continental-core","Eastern border reinforcement","EXISTING",800000000,230000000,4600000,1,30,0.012,0.04],
      ["france-biscay","geo-paris-iberian-market","Bay of Biscay cable","NEW",1000000000,780000000,13000000,4,31,0.012,0.03]
    ]
  ],
  "geo-madrid": [
    [
      ["geo-madrid-portuguese-market","Portugal","Atlantic wind and hydro often complement Spanish solar.",49,1500000000,1200000000],
      ["geo-madrid-continental-core","France and Continental Europe","The Pyrenees gateway reaches the larger European market, but it is often congested.",62,1800000000,2000000000]
    ],
    [
      ["spain-portugal-upgrade","geo-madrid-portuguese-market","Iberian border upgrade","EXISTING",650000000,180000000,3600000,1,34,0.014,0.05],
      ["spain-biscay","geo-madrid-continental-core","Bay of Biscay cable","NEW",1000000000,780000000,13000000,4,32,0.013,0.03]
    ]
  ],
  "geo-lisbon": [
    [
      ["geo-lisbon-spanish-market","Spain","The combined Iberian market shares changing supplies of wind, solar, hydro, and gas.",52,2000000000,1900000000]
    ],
    [
      ["portugal-spain-upgrade","geo-lisbon-spanish-market","Northern Iberian reinforcement","EXISTING",700000000,190000000,3800000,1,32,0.013,0.05]
    ]
  ],
  "geo-rome": [
    [
      ["geo-rome-alpine-market","Alpine neighbours","French, Swiss, Austrian, and Slovenian power crosses mountain passes, with strong winter demand.",61,2200000000,2100000000],
      ["geo-rome-adriatic-market","Adriatic and Balkan grids","Hydro, wind, and thermal power arrive by eastern land routes and undersea cables.",54,1600000000,1300000000]
    ],
    [
      ["italy-alpine-upgrade","geo-rome-alpine-market","Alpine border reinforcement","EXISTING",750000000,260000000,5200000,2,31,0.012,0.04],
      ["italy-mediterranean-link","geo-rome-adriatic-market","Mediterranean cable","NEW",600000000,690000000,11500000,4,34,0.013,0.03]
    ]
  ],
  "geo-berlin": [
    [
      ["geo-berlin-western-core","Western Europe","Dense borders share French nuclear, Benelux wind and gas, and Alpine hydro.",61,2800000000,2700000000],
      ["geo-berlin-nordic-market","Nordic and Danish market","Wind and reservoir hydro can absorb or fill Germany’s changing renewable supply.",48,2000000000,1700000000]
    ],
    [
      ["germany-west-upgrade","geo-berlin-western-core","Western grid reinforcement","EXISTING",800000000,210000000,4200000,1,30,0.012,0.04],
      ["germany-nordic-link","geo-berlin-nordic-market","North–south exchange link","NEW",700000000,440000000,7500000,3,28,0.01,0.03]
    ]
  ],
  "geo-vienna": [
    [
      ["geo-vienna-north-core","Germany and Czechia","Large connected markets can trade wind, solar, coal, gas, and nuclear power.",59,1800000000,1800000000],
      ["geo-vienna-alpine-balkan","Alps and Balkans","Hydro-rich neighbours can respond quickly, especially after rain and snowmelt.",55,1500000000,1300000000]
    ],
    [
      ["austria-north-upgrade","geo-vienna-north-core","Danube border upgrade","EXISTING",500000000,155000000,3100000,1,31,0.012,0.04],
      ["austria-south-upgrade","geo-vienna-alpine-balkan","Alpine exchange upgrade","EXISTING",450000000,180000000,3600000,2,30,0.012,0.04]
    ]
  ],
  "geo-zurich": [
    [
      ["geo-zurich-northwest-core","France and Germany","Big neighbouring markets bring nuclear, wind, and thermal power.",61,1900000000,2000000000],
      ["geo-zurich-italian-market","Italy","Italy often needs imports, while Alpine storage can earn money by exporting at busy hours.",66,1200000000,1800000000]
    ],
    [
      ["swiss-north-upgrade","geo-zurich-northwest-core","Northern border upgrade","EXISTING",500000000,170000000,3400000,1,29,0.011,0.04],
      ["swiss-south-upgrade","geo-zurich-italian-market","Alpine crossing upgrade","EXISTING",450000000,210000000,4200000,2,29,0.011,0.04]
    ]
  ],
  "geo-amsterdam": [
    [
      ["geo-amsterdam-core-neighbours","Belgium and Germany","Short, strong borders connect to the heart of the European market.",60,2200000000,2100000000],
      ["geo-amsterdam-north-sea-market","North Sea neighbours","Long DC cables reach Norwegian hydro, Danish wind, and Great Britain.",52,1600000000,1500000000]
    ],
    [
      ["netherlands-core-upgrade","geo-amsterdam-core-neighbours","Core border upgrade","EXISTING",650000000,170000000,3400000,1,30,0.012,0.04],
      ["netherlands-north-sea-upgrade","geo-amsterdam-north-sea-market","North Sea cable upgrade","EXISTING",500000000,270000000,5400000,2,28,0.01,0.02]
    ]
  ],
  "geo-brussels": [
    [
      ["geo-brussels-france-market","France","A large nuclear fleet can export steadily, but outages can quickly tighten prices.",60,2000000000,1900000000],
      ["geo-brussels-north-sea-core","Netherlands, Germany, and Great Britain","Several nearby grids offer a mix of wind, gas, coal, and imports.",62,1800000000,1900000000]
    ],
    [
      ["belgium-france-upgrade","geo-brussels-france-market","Southern border upgrade","EXISTING",550000000,150000000,3000000,1,30,0.012,0.04],
      ["belgium-north-upgrade","geo-brussels-north-sea-core","Northern exchange upgrade","EXISTING",500000000,170000000,3400000,1,29,0.011,0.03]
    ]
  ],
  "geo-copenhagen": [
    [
      ["geo-copenhagen-nordic-market","Nordic grid","Swedish and Norwegian hydro can balance Denmark’s changing wind output.",47,1900000000,1500000000],
      ["geo-copenhagen-continental-market","Continental and North Sea grid","Germany, the Netherlands, and Great Britain offer a much larger market for windy and calm hours.",61,2000000000,2100000000]
    ],
    [
      ["denmark-nordic-upgrade","geo-copenhagen-nordic-market","Øresund and Skagerrak upgrade","EXISTING",550000000,210000000,4200000,2,27,0.01,0.03],
      ["denmark-continent-upgrade","geo-copenhagen-continental-market","Continental cable upgrade","EXISTING",600000000,220000000,4400000,2,28,0.01,0.03]
    ]
  ],
  "geo-lista": [
    [
      ["geo-lista-nordic-market","Sweden and Finland","A shared Nordic grid moves hydro, wind, and nuclear power between regions.",47,1900000000,1700000000],
      ["geo-lista-north-sea-continent","North Sea and Continental Europe","Subsea cables reach Denmark, the Netherlands, Germany, and Great Britain.",61,2000000000,2300000000]
    ],
    [
      ["norway-nordic-upgrade","geo-lista-nordic-market","Nordic border upgrade","EXISTING",550000000,180000000,3600000,1,26,0.01,0.03],
      ["norway-north-sea-upgrade","geo-lista-north-sea-continent","North Sea converter upgrade","EXISTING",500000000,280000000,5600000,2,27,0.01,0.02]
    ]
  ],
  "geo-stockholm": [
    [
      ["geo-stockholm-nordic-market","Norway, Finland, and Denmark","The synchronous Nordic grid shares hydro, nuclear, and wind power.",47,2000000000,1700000000],
      ["geo-stockholm-baltic-continent","Baltic and Continental Europe","DC cables reach Lithuania, Poland, and Germany.",57,1600000000,1600000000]
    ],
    [
      ["sweden-nordic-upgrade","geo-stockholm-nordic-market","Nordic AC upgrade","EXISTING",600000000,180000000,3600000,1,26,0.01,0.03],
      ["sweden-baltic-upgrade","geo-stockholm-baltic-continent","Baltic cable upgrade","EXISTING",450000000,250000000,5000000,2,27,0.01,0.02]
    ]
  ],
  "geo-helsinki": [
    [
      ["geo-helsinki-nordic-market","Sweden and Norway","Nordic hydro, wind, and nuclear power share one synchronous grid.",48,1700000000,1600000000],
      ["geo-helsinki-baltic-market","Estonia and the Baltic states","Undersea DC cables connect Finland to Estonia and onward to Continental Europe.",56,1100000000,1200000000]
    ],
    [
      ["finland-nordic-upgrade","geo-helsinki-nordic-market","Northern border upgrade","EXISTING",500000000,170000000,3400000,1,25,0.01,0.03],
      ["finland-estlink-upgrade","geo-helsinki-baltic-market","Estlink upgrade","EXISTING",350000000,230000000,4600000,2,26,0.01,0.02]
    ]
  ],
  "geo-warsaw": [
    [
      ["geo-warsaw-western-core","Germany and Czechia","Large neighbouring markets mix wind, solar, nuclear, coal, and gas.",59,2100000000,2000000000],
      ["geo-warsaw-baltic-nordic","Baltic and Nordic market","Links through Lithuania and Sweden reach hydro, wind, and nuclear power.",54,1500000000,1400000000]
    ],
    [
      ["poland-west-upgrade","geo-warsaw-western-core","Western border upgrade","EXISTING",600000000,175000000,3500000,1,30,0.012,0.04],
      ["poland-baltic-upgrade","geo-warsaw-baltic-nordic","Baltic exchange upgrade","EXISTING",450000000,240000000,4800000,2,28,0.01,0.03]
    ]
  ],
  "geo-prague": [
    [
      ["geo-prague-west-core","Germany and Austria","Dense neighbouring grids provide a broad mix of power.",59,1900000000,1900000000],
      ["geo-prague-east-core","Poland and Slovakia","Industrial demand competes with coal, nuclear, wind, and hydro generation.",56,1500000000,1500000000]
    ],
    [
      ["czech-west-upgrade","geo-prague-west-core","Western border upgrade","EXISTING",500000000,145000000,2900000,1,30,0.012,0.04],
      ["czech-east-upgrade","geo-prague-east-core","Eastern border upgrade","EXISTING",450000000,150000000,3000000,1,30,0.012,0.04]
    ]
  ],
  "geo-budapest": [
    [
      ["geo-budapest-northwest-core","Austria and Slovakia","Connections lead toward large Central European markets.",59,1700000000,1600000000],
      ["geo-budapest-southern-balkan","Romania, Croatia, and Serbia","Hydro, nuclear, wind, and thermal power trade across several southern borders.",53,1500000000,1400000000]
    ],
    [
      ["hungary-northwest-upgrade","geo-budapest-northwest-core","Northwest border upgrade","EXISTING",500000000,155000000,3100000,1,32,0.013,0.04],
      ["hungary-south-upgrade","geo-budapest-southern-balkan","Southern border upgrade","EXISTING",450000000,150000000,3000000,1,33,0.013,0.05]
    ]
  ],
  "geo-bucharest": [
    [
      ["geo-bucharest-central-market","Hungary and Serbia","Connected neighbours share nuclear, hydro, wind, coal, and gas power.",55,1600000000,1500000000],
      ["geo-bucharest-black-sea-market","Bulgaria and Ukraine","A Black Sea corridor reaches hydro, nuclear, and thermal generators.",51,1500000000,1400000000]
    ],
    [
      ["romania-west-upgrade","geo-bucharest-central-market","Western border upgrade","EXISTING",500000000,150000000,3000000,1,33,0.014,0.05],
      ["romania-black-sea-upgrade","geo-bucharest-black-sea-market","Black Sea grid upgrade","EXISTING",450000000,165000000,3300000,2,33,0.014,0.05]
    ]
  ],
  "geo-sofia": [
    [
      ["geo-sofia-northwest-balkan","Romania and Serbia","Nuclear, hydro, and thermal power move around the Balkan grid.",52,1500000000,1400000000],
      ["geo-sofia-south-market","Greece and Türkiye","Southern demand, solar, gas, and hydro create strong daily price swings.",57,1600000000,1700000000]
    ],
    [
      ["bulgaria-north-upgrade","geo-sofia-northwest-balkan","Danube border upgrade","EXISTING",500000000,155000000,3100000,1,34,0.014,0.05],
      ["bulgaria-turkey-upgrade","geo-sofia-south-market","Türkiye border upgrade","EXISTING",550000000,190000000,3800000,2,35,0.014,0.05]
    ]
  ],
  "geo-belgrade": [
    [
      ["geo-belgrade-northwest-market","Hungary and Croatia","Central European markets add wind, nuclear, hydro, and gas power.",56,1500000000,1500000000],
      ["geo-belgrade-east-balkan","Romania and Bulgaria","Hydro, nuclear, and thermal fleets can trade at busy hours.",52,1400000000,1300000000]
    ],
    [
      ["serbia-north-upgrade","geo-belgrade-northwest-market","Northern border upgrade","EXISTING",450000000,145000000,2900000,1,34,0.014,0.05],
      ["serbia-east-upgrade","geo-belgrade-east-balkan","Danube exchange upgrade","EXISTING",450000000,150000000,3000000,1,34,0.014,0.05]
    ]
  ],
  "geo-zagreb": [
    [
      ["geo-zagreb-alpine-market","Slovenia and Hungary","Connections lead into the larger Central European market.",57,1500000000,1500000000],
      ["geo-zagreb-western-balkan","Serbia and Bosnia","Hydro and thermal systems can help each other when water or fuel conditions differ.",51,1300000000,1200000000]
    ],
    [
      ["croatia-alpine-upgrade","geo-zagreb-alpine-market","Alpine gateway upgrade","EXISTING",450000000,145000000,2900000,1,33,0.014,0.05],
      ["croatia-balkan-upgrade","geo-zagreb-western-balkan","Balkan border upgrade","EXISTING",400000000,140000000,2800000,1,34,0.014,0.05]
    ]
  ],
  "geo-athens": [
    [
      ["geo-athens-balkan-market","Bulgaria and Türkiye","Land links reach Balkan hydro, nuclear, gas, coal, wind, and solar.",56,1600000000,1600000000],
      ["geo-athens-italian-market","Italy","An undersea cable links two Mediterranean markets with different busy hours.",65,1200000000,1600000000]
    ],
    [
      ["greece-balkan-upgrade","geo-athens-balkan-market","Northern border upgrade","EXISTING",500000000,170000000,3400000,1,35,0.014,0.05],
      ["greece-italy-upgrade","geo-athens-italian-market","Adriatic cable upgrade","EXISTING",350000000,240000000,4800000,2,33,0.012,0.02]
    ]
  ],
  "geo-kyiv": [
    [
      ["geo-kyiv-continental-west","Continental Europe","Poland, Slovakia, Hungary, and Romania connect Ukraine to Europe's coordinated grid.",57,1700000000,1900000000]
    ],
    [
      ["ukraine-west-upgrade","geo-kyiv-continental-west","Western synchronization upgrade","EXISTING",500000000,220000000,4400000,2,31,0.012,0.04]
    ]
  ],
  "geo-minsk": [
    [
      ["geo-minsk-russian-market","Russia","The two power systems still operate at one frequency and exchange power, while the former Baltic routes are closed.",46,1600000000,1500000000]
    ],
    [
      ["belarus-russia-upgrade","geo-minsk-russian-market","Russia border upgrade","EXISTING",450000000,160000000,3200000,1,29,0.011,0.04]
    ]
  ],
  "geo-tallinn": [
    [
      ["geo-tallinn-finnish-market","Finland","Two undersea DC links reach the Nordic market.",49,1100000000,1200000000],
      ["geo-tallinn-baltic-market","Latvia and Continental Europe","The Baltic grids now share Continental Europe's frequency and reach Poland through Lithuania.",55,1300000000,1200000000]
    ],
    [
      ["estonia-estlink-upgrade","geo-tallinn-finnish-market","Estlink upgrade","EXISTING",350000000,230000000,4600000,2,27,0.01,0.02],
      ["estonia-latvia-upgrade","geo-tallinn-baltic-market","Baltic AC upgrade","EXISTING",350000000,125000000,2500000,1,28,0.011,0.03]
    ]
  ],
  "geo-riga": [
    [
      ["geo-riga-baltic-market","Estonia and Lithuania","The three Baltic grids share power and one Continental European frequency.",54,1300000000,1200000000],
      ["geo-riga-nordic-market","Nordic market","Power reaches Finland through Estonia and Sweden through Lithuania.",48,1100000000,1100000000]
    ],
    [
      ["latvia-baltic-upgrade","geo-riga-baltic-market","Baltic corridor upgrade","EXISTING",400000000,135000000,2700000,1,28,0.011,0.03],
      ["latvia-nordic-converter","geo-riga-nordic-market","Nordic converter reinforcement","NEW",300000000,260000000,4800000,3,27,0.01,0.02]
    ]
  ],
  "geo-vilnius": [
    [
      ["geo-vilnius-polish-market","Poland and Continental Europe","LitPol Link is the Baltic land gateway to the larger Continental European grid.",57,1400000000,1500000000],
      ["geo-vilnius-swedish-market","Sweden","NordBalt reaches Nordic hydro, nuclear, and wind across the sea.",48,1100000000,1100000000]
    ],
    [
      ["lithuania-litpol-upgrade","geo-vilnius-polish-market","LitPol Link upgrade","EXISTING",450000000,175000000,3500000,2,29,0.011,0.03],
      ["lithuania-nordbalt-upgrade","geo-vilnius-swedish-market","NordBalt upgrade","EXISTING",350000000,240000000,4800000,2,27,0.01,0.02]
    ]
  ],
  "geo-moscow": [
    [
      ["geo-moscow-russian-regions","Russia's connected regions","High-voltage lines join the Central, North-West, Volga, Ural, Southern, and Siberian systems.",44,2600000000,2500000000],
      ["geo-moscow-belarus-market","Belarus","Belarus and Russia remain synchronized and can exchange power.",46,1300000000,1200000000]
    ],
    [
      ["russia-regional-upgrade","geo-moscow-russian-regions","Inter-regional grid upgrade","EXISTING",700000000,220000000,4400000,2,27,0.01,0.03],
      ["russia-belarus-upgrade","geo-moscow-belarus-market","Belarus border upgrade","EXISTING",400000000,160000000,3200000,1,29,0.011,0.04]
    ]
  ],
  "geo-istanbul": [
    [
      ["geo-istanbul-continental-europe","Continental Europe","Türkiye shares one frequency with Bulgaria and Greece, reaching Europe's large power market.",59,2000000000,2100000000],
      ["geo-istanbul-caucasus-market","Georgia and the Caucasus","An asynchronous gateway reaches Georgian hydro and the wider Caucasus grid.",47,1300000000,1200000000]
    ],
    [
      ["turkey-europe-upgrade","geo-istanbul-continental-europe","Thrace border upgrade","EXISTING",600000000,210000000,4200000,2,35,0.014,0.05],
      ["turkey-georgia-upgrade","geo-istanbul-caucasus-market","Georgia converter upgrade","EXISTING",450000000,230000000,4600000,2,35,0.014,0.04]
    ]
  ],
  "geo-dubai": [
    [
      ["geo-dubai-gcc-north","Saudi Arabia and the northern Gulf","The GCC backbone shares gas-fired power and emergency reserves across the Gulf.",53,1500000000,1500000000],
      ["geo-dubai-oman-market","Oman","Oman's later afternoon peak can differ from the Emirates, creating time to trade.",51,900000000,1000000000]
    ],
    [
      ["uae-gcc-upgrade","geo-dubai-gcc-north","GCC backbone upgrade","EXISTING",500000000,190000000,3800000,2,38,0.018,0.08],
      ["uae-oman-upgrade","geo-dubai-oman-market","Oman gateway upgrade","EXISTING",300000000,140000000,2800000,1,38,0.018,0.08]
    ]
  ],
  "geo-doha": [
    [
      ["geo-doha-gcc-backbone","GCC power market","A regional safety net lets Qatar exchange gas-fired power and reserves with its neighbours.",52,1100000000,1200000000]
    ],
    [
      ["qatar-gcc-upgrade","geo-doha-gcc-backbone","Qatar–GCC upgrade","EXISTING",400000000,175000000,3500000,2,38,0.018,0.08]
    ]
  ],
  "geo-manama": [
    [
      ["geo-manama-gcc-backbone","GCC power market","Two undersea cables connect Bahrain to a regional grid that can share reserves and energy.",52,900000000,1000000000]
    ],
    [
      ["bahrain-cable-upgrade","geo-manama-gcc-backbone","Bahrain cable upgrade","EXISTING",300000000,210000000,4200000,2,38,0.016,0.03]
    ]
  ],
  "geo-kuwaitcity": [
    [
      ["geo-kuwaitcity-gcc-backbone","Saudi Arabia and the GCC","A 400 kV backbone shares power and reserves across the Gulf.",52,1400000000,1500000000],
      ["geo-kuwaitcity-iraq-market","Southern Iraq","A new route can send Gulf electricity to Iraq and create a new trading border.",58,700000000,1000000000]
    ],
    [
      ["kuwait-gcc-upgrade","geo-kuwaitcity-gcc-backbone","Al-Fadhili corridor upgrade","EXISTING",500000000,190000000,3800000,2,39,0.018,0.08],
      ["kuwait-iraq-link","geo-kuwaitcity-iraq-market","Al-Wafrah–Al-Faw link","NEW",500000000,390000000,7200000,3,39,0.018,0.08]
    ]
  ],
  "geo-muscat": [
    [
      ["geo-muscat-uae-market","United Arab Emirates","Oman reaches the wider GCC grid through the Emirates.",53,1000000000,1100000000],
      ["geo-muscat-gcc-direct","Direct GCC backbone","A planned direct route would reduce reliance on the single path through the UAE.",51,1300000000,1300000000]
    ],
    [
      ["oman-uae-upgrade","geo-muscat-uae-market","Mahdha gateway upgrade","EXISTING",300000000,145000000,2900000,1,38,0.018,0.08],
      ["oman-gcc-direct","geo-muscat-gcc-direct","Direct GCC connection","NEW",600000000,420000000,7800000,3,38,0.018,0.08]
    ]
  ],
  "geo-riyadh": [
    [
      ["geo-riyadh-gcc-market","GCC neighbours","A frequency converter connects Saudi Arabia's 60 Hz grid to the GCC's 50 Hz backbone.",52,1700000000,1700000000],
      ["geo-riyadh-egypt-market","Egypt","Different evening peak times across the Red Sea can help both grids share power.",55,1500000000,1600000000]
    ],
    [
      ["saudi-gcc-upgrade","geo-riyadh-gcc-market","GCC converter upgrade","EXISTING",600000000,250000000,5000000,2,39,0.018,0.08],
      ["saudi-egypt-link","geo-riyadh-egypt-market","Saudi–Egypt HVDC link","NEW",750000000,620000000,11000000,4,38,0.016,0.03]
    ]
  ],
  "geo-baghdad": [
    [
      ["geo-baghdad-iran-market","Iran","Existing eastern links can import power, but availability and contracts can change.",54,900000000,1100000000],
      ["geo-baghdad-gcc-jordan-market","GCC and Jordan","New western and southern routes can diversify Iraq's supply.",56,1200000000,1200000000]
    ],
    [
      ["iraq-iran-upgrade","geo-baghdad-iran-market","Eastern intertie upgrade","EXISTING",350000000,175000000,3500000,2,40,0.018,0.08],
      ["iraq-gcc-link","geo-baghdad-gcc-jordan-market","GCC–Iraq connection","NEW",500000000,410000000,7500000,3,40,0.018,0.08]
    ]
  ],
  "geo-tehran": [
    [
      ["geo-tehran-caucasus-market","Armenia and Azerbaijan","Northern links exchange thermal, hydro, and seasonal power with the Caucasus.",47,1100000000,1000000000],
      ["geo-tehran-western-market","Türkiye and Iraq","Western links can trade power, though transfer limits and operating agreements vary.",55,1100000000,1200000000]
    ],
    [
      ["iran-armenia-upgrade","geo-tehran-caucasus-market","Armenia border upgrade","EXISTING",400000000,190000000,3800000,2,38,0.017,0.07],
      ["iran-west-upgrade","geo-tehran-western-market","Western intertie upgrade","EXISTING",350000000,180000000,3600000,2,39,0.018,0.08]
    ]
  ],
  "geo-amman": [
    [
      ["geo-amman-egypt-market","Egypt","A short cable under the Gulf of Aqaba connects two grids with different peak times.",54,1000000000,1100000000],
      ["geo-amman-iraq-saudi-market","Iraq and Saudi Arabia","New desert routes can widen regional trade and emergency support.",55,900000000,1000000000]
    ],
    [
      ["jordan-egypt-upgrade","geo-amman-egypt-market","Aqaba cable upgrade","EXISTING",350000000,220000000,4400000,2,38,0.016,0.03],
      ["jordan-east-link","geo-amman-iraq-saudi-market","Eastern regional link","NEW",400000000,300000000,5800000,3,38,0.018,0.08]
    ]
  ],
  "geo-beirut": [
    [
      ["geo-beirut-levant-market","Syria and Jordan","Physical links can bring regional power, but outages and contracts may leave little available.",59,250000000,450000000]
    ],
    [
      ["lebanon-levant-repair","geo-beirut-levant-market","Levant intertie restoration","EXISTING",200000000,140000000,2800000,2,35,0.014,0.05]
    ]
  ],
  "geo-damascus": [
    [
      ["geo-damascus-jordan-market","Jordan and Egypt","The southbound link reaches Jordan and Egypt, but transfers may be unavailable.",57,300000000,500000000],
      ["geo-damascus-turkey-market","Türkiye","A northern 400 kV route exists, but it is not part of Türkiye's synchronous European trading border.",60,250000000,450000000]
    ],
    [
      ["syria-jordan-restoration","geo-damascus-jordan-market","Jordan link restoration","EXISTING",200000000,150000000,3000000,2,38,0.017,0.07],
      ["syria-turkey-restoration","geo-damascus-turkey-market","Türkiye link restoration","EXISTING",200000000,160000000,3200000,2,38,0.017,0.07]
    ]
  ],
  "geo-telaviv": [
    [
      ["geo-telaviv-east-mediterranean","Cyprus and Greece","A planned long subsea cable could connect today's isolated market to Europe.",63,900000000,1000000000]
    ],
    [
      ["israel-great-sea","geo-telaviv-east-mediterranean","Great Sea Interconnector","NEW",500000000,850000000,14000000,4,36,0.014,0.02]
    ]
  ],
  "geo-baku": [
    [
      ["geo-baku-caucasus-market","Georgia and Russia","Azerbaijan shares a synchronous regional system and trades through Georgia.",46,1200000000,1100000000],
      ["geo-baku-turkey-market","Türkiye via Nakhchivan","A smaller western route reaches Türkiye, with a wider green corridor planned through Georgia.",58,700000000,800000000]
    ],
    [
      ["azerbaijan-georgia-upgrade","geo-baku-caucasus-market","Georgia border upgrade","EXISTING",400000000,165000000,3300000,2,37,0.016,0.06],
      ["azerbaijan-turkey-upgrade","geo-baku-turkey-market","Nakhchivan link upgrade","EXISTING",200000000,150000000,3000000,2,38,0.017,0.07]
    ]
  ],
  "geo-tbilisi": [
    [
      ["geo-tbilisi-caucasus-market","Russia, Azerbaijan, and Armenia","Georgia sits between hydro-rich and thermal systems and can exchange in several directions.",46,1300000000,1100000000],
      ["geo-tbilisi-turkey-market","Türkiye","A converter lets asynchronous grids trade without sharing one frequency.",58,900000000,1000000000]
    ],
    [
      ["georgia-caucasus-upgrade","geo-tbilisi-caucasus-market","Caucasus border upgrade","EXISTING",450000000,175000000,3500000,2,35,0.015,0.05],
      ["georgia-turkey-link","geo-tbilisi-turkey-market","Akhaltsikhe–Tortum link","NEW",500000000,310000000,5800000,3,35,0.015,0.04]
    ]
  ],
  "geo-yerevan": [
    [
      ["geo-yerevan-iran-market","Iran","Gas-for-electricity exchange and power lines make Iran an important southern partner.",49,900000000,900000000],
      ["geo-yerevan-georgia-market","Georgia and the Caucasus","A northern link can reach Georgian hydro and wider regional trade.",46,800000000,850000000]
    ],
    [
      ["armenia-iran-upgrade","geo-yerevan-iran-market","Iran 400 kV upgrade","NEW",500000000,280000000,5200000,3,37,0.016,0.06],
      ["armenia-georgia-link","geo-yerevan-georgia-market","Caucasus transmission link","NEW",350000000,260000000,4800000,3,35,0.015,0.05]
    ]
  ],
  "geo-tashkent": [
    [
      ["geo-tashkent-central-asian-market","Kazakhstan and Central Asia","A regional system shares hydro and thermal power across seasons.",40,1300000000,1200000000],
      ["geo-tashkent-afghanistan-market","Afghanistan","Afghanistan buys power from Uzbekistan, creating export demand south of the border.",50,300000000,600000000]
    ],
    [
      ["uzbekistan-central-upgrade","geo-tashkent-central-asian-market","Central Asian grid upgrade","EXISTING",450000000,150000000,3000000,2,39,0.017,0.07],
      ["uzbekistan-afghan-upgrade","geo-tashkent-afghanistan-market","Surkhan–Pul-e-Khumri line","NEW",350000000,230000000,4600000,3,40,0.018,0.08]
    ]
  ],
  "geo-almaty": [
    [
      ["geo-almaty-russian-market","Russia","Kazakhstan operates in parallel with Russia and settles changing cross-border flows.",44,1800000000,1700000000],
      ["geo-almaty-central-asian-market","Uzbekistan and Central Asia","Southern links share thermal and hydro power across the region.",40,1400000000,1300000000]
    ],
    [
      ["kazakhstan-russia-upgrade","geo-almaty-russian-market","Northern border upgrade","EXISTING",600000000,190000000,3800000,2,34,0.014,0.05],
      ["kazakhstan-central-upgrade","geo-almaty-central-asian-market","Central Asian corridor upgrade","EXISTING",500000000,170000000,3400000,2,38,0.017,0.07]
    ]
  ],
  "geo-kabul": [
    [
      ["geo-kabul-uzbek-market","Uzbekistan","Imported power travels south from Uzbekistan; Kabul depends on long transmission routes.",45,500000000,250000000],
      ["geo-kabul-tajik-hydro","Tajik and Kyrgyz hydropower","CASA-1000 is designed to move summer hydro surplus through Afghanistan.",38,400000000,250000000]
    ],
    [
      ["afghanistan-uzbek-upgrade","geo-kabul-uzbek-market","Northern import upgrade","EXISTING",250000000,170000000,3400000,2,40,0.018,0.08],
      ["afghanistan-casa","geo-kabul-tajik-hydro","CASA-1000 corridor","NEW",300000000,300000000,5500000,4,39,0.017,0.07]
    ]
  ],
  "geo-cairo": [
    [
      ["geo-cairo-libyan-coast","Libyan coast","A smaller neighbouring grid often needs imports, but the desert border line can also help during an Egyptian shortage.",76,300000000,500000000],
      ["geo-cairo-jordan-levant","Jordan and the Levant","A Red Sea cable shares thermal and renewable power between two grids whose busiest hours do not always match.",68,550000000,600000000]
    ],
    [
      ["egypt-libya-upgrade","geo-cairo-libyan-coast","Western desert line upgrade","EXISTING",200000000,120000000,2400000,1,39,0.018,0.08],
      ["egypt-jordan-upgrade","geo-cairo-jordan-levant","Gulf of Aqaba cable upgrade","EXISTING",350000000,230000000,4600000,2,38,0.017,0.03]
    ]
  ],
  "geo-casablanca": [
    [
      ["geo-casablanca-iberian-market","Spain and the Iberian market","Two undersea links reach a large market with wind, solar, hydro, nuclear, and gas.",58,1300000000,1500000000],
      ["geo-casablanca-portuguese-atlantic","Portugal by Atlantic cable","A proposed cable would add another route to Atlantic wind and reservoir hydropower.",53,900000000,800000000]
    ],
    [
      ["morocco-spain-upgrade","geo-casablanca-iberian-market","Strait of Gibraltar upgrade","EXISTING",600000000,300000000,5400000,2,34,0.014,0.03],
      ["morocco-portugal-cable","geo-casablanca-portuguese-atlantic","Atlantic cable to Portugal","NEW",700000000,690000000,11500000,4,34,0.014,0.02]
    ]
  ],
  "geo-algiers": [
    [
      ["geo-algiers-tunisian-market","Tunisia","The Maghreb backbone can exchange gas-fired and renewable power, although a hot regional evening tightens both grids.",64,650000000,700000000],
      ["geo-algiers-spanish-market","Spain by Mediterranean cable","A proposed subsea link would reach the larger Iberian market without depending on a land border.",58,1000000000,1100000000]
    ],
    [
      ["algeria-tunisia-upgrade","geo-algiers-tunisian-market","Maghreb line upgrade","EXISTING",300000000,150000000,3000000,1,39,0.018,0.08],
      ["algeria-spain-cable","geo-algiers-spanish-market","Alboran Sea cable","NEW",700000000,720000000,12000000,4,36,0.015,0.02]
    ]
  ],
  "geo-tunis": [
    [
      ["geo-tunis-algerian-market","Algeria","A larger gas-rich neighbour can send power west-to-east or buy Tunisian surplus when its own demand rises.",61,700000000,650000000],
      ["geo-tunis-sicilian-market","Sicily and Italy","A new undersea cable would connect North African sun and Italian demand.",69,800000000,1000000000]
    ],
    [
      ["tunisia-algeria-upgrade","geo-tunis-algerian-market","Western Maghreb upgrade","EXISTING",300000000,150000000,3000000,1,37,0.017,0.07],
      ["tunisia-italy-elmed","geo-tunis-sicilian-market","ELMED cable","NEW",600000000,690000000,11500000,4,35,0.015,0.02]
    ]
  ],
  "geo-tripoli": [
    [
      ["geo-tripoli-egyptian-market","Egypt","The eastern neighbour has a much larger grid, but a long desert line limits how much can arrive.",67,400000000,450000000],
      ["geo-tripoli-tunisian-market","Tunisia","The western route can bring Maghreb power when Libya's local plants are short.",64,500000000,550000000]
    ],
    [
      ["libya-egypt-upgrade","geo-tripoli-egyptian-market","Tobruk–Saloum upgrade","EXISTING",200000000,125000000,2500000,1,39,0.018,0.08],
      ["libya-tunisia-upgrade","geo-tripoli-tunisian-market","Western coastal line upgrade","EXISTING",300000000,170000000,3400000,2,39,0.018,0.08]
    ]
  ],
  "geo-lagos": [
    [
      ["geo-lagos-benin-togo-market","Benin and Togo","The coastal backbone lets Nigeria sell power west or buy help when local plants and fuel supplies are tight.",72,550000000,700000000],
      ["geo-lagos-sahel-market","Niger and Burkina Faso","Northern neighbours have smaller grids and strong daytime solar, but very hot weather raises demand and line losses.",66,500000000,550000000]
    ],
    [
      ["nigeria-benin-upgrade","geo-lagos-benin-togo-market","Lagos–Sakété upgrade","EXISTING",350000000,155000000,3100000,1,36,0.016,0.06],
      ["wapp-north-core","geo-lagos-sahel-market","North Core line","NEW",500000000,390000000,7000000,3,40,0.019,0.08]
    ]
  ],
  "geo-accra": [
    [
      ["geo-accra-ivorian-market","Côte d'Ivoire","Hydro and gas on the western grid can cover a shortage, while Ghanaian surplus can flow the other way.",61,700000000,700000000],
      ["geo-accra-togo-benin-market","Togo and Benin","The coastal line reaches smaller importing grids and, beyond them, Nigeria.",70,500000000,650000000]
    ],
    [
      ["ghana-ivory-coast-upgrade","geo-accra-ivorian-market","Western coastal upgrade","EXISTING",400000000,180000000,3600000,1,35,0.016,0.05],
      ["ghana-togo-upgrade","geo-accra-togo-benin-market","Eastern coastal upgrade","EXISTING",300000000,145000000,2900000,1,35,0.016,0.05]
    ]
  ],
  "geo-abidjan": [
    [
      ["geo-abidjan-ghanaian-market","Ghana","The coastal neighbour mixes hydro, gas, and growing solar, so either grid may have surplus at a different hour.",62,700000000,700000000],
      ["geo-abidjan-sahel-west-market","Mali and Burkina Faso","Northern grids often need imports, while sunny hours can create a smaller solar surplus.",68,400000000,650000000]
    ],
    [
      ["ivory-coast-ghana-upgrade","geo-abidjan-ghanaian-market","Aboadze–Riviera upgrade","EXISTING",400000000,180000000,3600000,1,35,0.016,0.05],
      ["ivory-coast-mali-upgrade","geo-abidjan-sahel-west-market","Northern export route upgrade","EXISTING",250000000,150000000,3000000,2,38,0.018,0.07]
    ]
  ],
  "geo-dakar": [
    [
      ["geo-dakar-mali-hydro-market","Mali and Senegal River hydropower","Shared river dams can provide low-cost power, but dry seasons leave less water to generate.",55,400000000,450000000],
      ["geo-dakar-omvg-coastal-market","Gambia, Guinea, and Guinea-Bissau","A regional loop links several small grids so they can share hydro, solar, and thermal backup.",63,350000000,450000000]
    ],
    [
      ["senegal-mali-upgrade","geo-dakar-mali-hydro-market","Eastern 225 kV upgrade","EXISTING",250000000,155000000,3100000,2,38,0.018,0.07],
      ["senegal-omvg-upgrade","geo-dakar-omvg-coastal-market","Coastal power-loop upgrade","EXISTING",250000000,165000000,3300000,2,35,0.016,0.05]
    ]
  ],
  "geo-bamako": [
    [
      ["geo-bamako-ivorian-market","Côte d'Ivoire","A larger coastal grid can send hydro and gas-fired power north when Mali's supply is tight.",62,450000000,500000000],
      ["geo-bamako-senegal-river-market","Senegal River grid","Shared hydropower is flexible, but output changes with the wet and dry seasons.",55,350000000,350000000]
    ],
    [
      ["mali-ivory-coast-upgrade","geo-bamako-ivorian-market","Southern 225 kV upgrade","EXISTING",250000000,150000000,3000000,2,40,0.019,0.08],
      ["mali-senegal-upgrade","geo-bamako-senegal-river-market","Kayes–Tambacounda upgrade","EXISTING",250000000,155000000,3100000,2,40,0.019,0.08]
    ]
  ],
  "geo-ouagadougou": [
    [
      ["geo-ouagadougou-ghanaian-market","Ghana","Power from Ghana's hydro and gas plants can travel north, while Burkina's midday solar can reduce imports.",62,450000000,550000000],
      ["geo-ouagadougou-north-core-market","Niger, Benin, and Nigeria","A new high-voltage backbone would open a second direction for regional trade.",68,500000000,550000000]
    ],
    [
      ["burkina-ghana-upgrade","geo-ouagadougou-ghanaian-market","Bolgatanga–Ouagadougou upgrade","EXISTING",250000000,145000000,2900000,2,40,0.019,0.08],
      ["burkina-north-core","geo-ouagadougou-north-core-market","North Core completion","NEW",400000000,340000000,6100000,3,41,0.02,0.09]
    ]
  ],
  "geo-niamey": [
    [
      ["geo-niamey-nigerian-market","Nigeria","Long-running northern lines import power from Nigeria, but supply may tighten when both countries need cooling.",70,450000000,550000000],
      ["geo-niamey-north-core-market","Benin and Burkina Faso","The new North Core backbone would add more routes instead of depending mainly on one neighbour.",68,400000000,450000000]
    ],
    [
      ["niger-nigeria-upgrade","geo-niamey-nigerian-market","Northern border upgrade","EXISTING",200000000,135000000,2700000,2,42,0.02,0.09],
      ["niger-north-core","geo-niamey-north-core-market","Niamey North Core section","NEW",400000000,360000000,6500000,3,42,0.02,0.09]
    ]
  ],
  "geo-khartoum": [
    [
      ["geo-khartoum-ethiopian-hydro","Ethiopian hydropower","Rainy-season hydro can be inexpensive, while dry years reduce the surplus available to export.",45,500000000,350000000],
      ["geo-khartoum-egyptian-market","Egypt","The northern grid is much larger and can support emergencies, but the present border path is limited.",69,350000000,400000000]
    ],
    [
      ["sudan-ethiopia-upgrade","geo-khartoum-ethiopian-hydro","Eastern 230 kV upgrade","EXISTING",250000000,150000000,3000000,2,41,0.019,0.08],
      ["sudan-egypt-upgrade","geo-khartoum-egyptian-market","Nile Valley upgrade","EXISTING",200000000,145000000,2900000,2,41,0.019,0.08]
    ]
  ],
  "geo-addisababa": [
    [
      ["geo-addisababa-kenyan-market","Kenya","A modern converter sends Ethiopian hydropower south to a grid with geothermal, wind, hydro, and thermal generation.",57,1000000000,1000000000],
      ["geo-addisababa-sudan-djibouti-market","Sudan and Djibouti","Older regional lines serve smaller markets; dry weather can tighten hydropower exports.",62,500000000,550000000]
    ],
    [
      ["ethiopia-kenya-upgrade","geo-addisababa-kenyan-market","Eastern Electricity Highway upgrade","EXISTING",600000000,260000000,5200000,2,34,0.012,0.03],
      ["ethiopia-sudan-upgrade","geo-addisababa-sudan-djibouti-market","Metema border upgrade","EXISTING",250000000,150000000,3000000,2,38,0.016,0.06]
    ]
  ],
  "geo-nairobi": [
    [
      ["geo-nairobi-ethiopian-hydro","Ethiopian hydropower","The long HVDC highway brings low-carbon power, though drought can reduce how much is offered.",45,1000000000,700000000],
      ["geo-nairobi-tanzanian-market","Tanzania","A newly energized 400 kV line links hydro, gas, and growing solar resources on both sides of the border.",60,700000000,750000000]
    ],
    [
      ["kenya-ethiopia-upgrade","geo-nairobi-ethiopian-hydro","Suswa converter upgrade","EXISTING",600000000,260000000,5200000,2,34,0.012,0.03],
      ["kenya-tanzania-upgrade","geo-nairobi-tanzanian-market","Isinya–Arusha upgrade","EXISTING",400000000,190000000,3800000,2,35,0.015,0.05]
    ]
  ],
  "geo-kampala": [
    [
      ["geo-kampala-kenyan-market","Kenya","Geothermal, wind, hydro, and imports from Ethiopia make Kenya a diverse eastern neighbour.",57,550000000,600000000],
      ["geo-kampala-great-lakes-market","Rwanda and the Great Lakes grid","Smaller linked grids share river hydropower and support one another when a plant is unavailable.",61,350000000,400000000]
    ],
    [
      ["uganda-kenya-upgrade","geo-kampala-kenyan-market","Tororo border upgrade","EXISTING",250000000,145000000,2900000,2,34,0.015,0.05],
      ["uganda-rwanda-upgrade","geo-kampala-great-lakes-market","Mirama–Shango upgrade","EXISTING",200000000,135000000,2700000,2,33,0.015,0.05]
    ]
  ],
  "geo-kigali": [
    [
      ["geo-kigali-uganda-market","Uganda","A northern connection gives access to Uganda's hydro grid and, through it, Kenya.",58,350000000,350000000],
      ["geo-kigali-great-lakes-market","Burundi and eastern DR Congo","Shared river plants and short border lines connect several small Great Lakes grids.",61,300000000,350000000]
    ],
    [
      ["rwanda-uganda-upgrade","geo-kigali-uganda-market","Shango–Mirama upgrade","EXISTING",200000000,135000000,2700000,2,31,0.012,0.04],
      ["rwanda-great-lakes-upgrade","geo-kigali-great-lakes-market","Great Lakes network upgrade","EXISTING",180000000,130000000,2600000,2,31,0.012,0.04]
    ]
  ],
  "geo-daressalaam": [
    [
      ["geo-daressalaam-kenyan-market","Kenya and Ethiopia","The northern route can bring Kenyan geothermal and Ethiopian hydro, with Kenya carrying power between markets.",55,750000000,700000000],
      ["geo-daressalaam-southern-pool","Southern African Power Pool","A future southern gateway would connect Tanzania to Zambia and the larger SAPP market.",63,650000000,700000000]
    ],
    [
      ["tanzania-kenya-upgrade","geo-daressalaam-kenyan-market","Arusha–Isinya upgrade","EXISTING",400000000,190000000,3800000,2,36,0.016,0.05],
      ["tanzania-zambia-link","geo-daressalaam-southern-pool","Tanzania–Zambia gateway","NEW",450000000,370000000,6700000,3,38,0.017,0.06]
    ]
  ],
  "geo-kinshasa": [
    [
      ["geo-kinshasa-zambian-market","Zambia and the southern pool","The southern link reaches copper-belt demand and a much wider power pool.",62,600000000,700000000],
      ["geo-kinshasa-great-lakes-market","Rwanda and Burundi","Small eastern grids share river hydropower across the Great Lakes region.",60,300000000,350000000]
    ],
    [
      ["drc-zambia-upgrade","geo-kinshasa-zambian-market","Copperbelt border upgrade","EXISTING",350000000,190000000,3800000,2,36,0.016,0.05],
      ["drc-rwanda-upgrade","geo-kinshasa-great-lakes-market","Ruzizi network upgrade","EXISTING",180000000,130000000,2600000,2,33,0.014,0.04]
    ]
  ],
  "geo-luanda": [
    [
      ["geo-luanda-southern-pool","Namibia and the southern pool","A first regional line would let Angola share hydropower with Namibia and reach the wider SAPP market.",61,550000000,600000000]
    ],
    [
      ["angola-namibia-anna","geo-luanda-southern-pool","Angola–Namibia interconnector","NEW",400000000,390000000,7000000,4,39,0.018,0.07]
    ]
  ],
  "geo-lusaka": [
    [
      ["geo-lusaka-congo-copperbelt","DR Congo Copperbelt","Hydropower and mining demand sit on both sides of the border, so flows can change direction.",62,600000000,650000000],
      ["geo-lusaka-zimbabwe-market","Zimbabwe and the Kariba grid","Shared reservoir power and southern trade meet at a busy regional junction.",65,700000000,800000000]
    ],
    [
      ["zambia-drc-upgrade","geo-lusaka-congo-copperbelt","Copperbelt intertie upgrade","EXISTING",350000000,190000000,3800000,2,36,0.016,0.05],
      ["zambia-zimbabwe-upgrade","geo-lusaka-zimbabwe-market","Kariba corridor upgrade","EXISTING",450000000,210000000,4200000,2,37,0.016,0.06]
    ]
  ],
  "geo-harare": [
    [
      ["geo-harare-zambian-market","Zambia","Hydropower crosses near Kariba, but drought can tighten both grids at the same time.",60,650000000,700000000],
      ["geo-harare-mozambique-market","Mozambique","Cahora Bassa hydropower and southern lines give a second direction for imports and exports.",58,700000000,650000000]
    ],
    [
      ["zimbabwe-zambia-upgrade","geo-harare-zambian-market","Kariba corridor upgrade","EXISTING",400000000,200000000,4000000,2,37,0.016,0.06],
      ["zimbabwe-mozambique-upgrade","geo-harare-mozambique-market","Eastern border upgrade","EXISTING",350000000,190000000,3800000,2,36,0.016,0.05]
    ]
  ],
  "geo-maputo": [
    [
      ["geo-maputo-south-african-market","South Africa","A very large neighbour can buy Cahora Bassa power or send emergency support, but its own system can also be stressed.",67,1100000000,1200000000],
      ["geo-maputo-zimbabwe-zambia-market","Zimbabwe and Zambia","Northern routes connect reservoir hydro and mining demand across the pool.",61,650000000,700000000]
    ],
    [
      ["mozambique-south-africa-upgrade","geo-maputo-south-african-market","MOTRACO corridor upgrade","EXISTING",600000000,250000000,5000000,2,35,0.015,0.05],
      ["mozambique-zimbabwe-upgrade","geo-maputo-zimbabwe-zambia-market","Western border upgrade","EXISTING",350000000,190000000,3800000,2,36,0.016,0.05]
    ]
  ],
  "geo-gaborone": [
    [
      ["geo-gaborone-south-african-market","South Africa","Several border lines reach a huge market, but imports become expensive when the southern grid is short.",68,800000000,900000000],
      ["geo-gaborone-zimbabwe-market","Zimbabwe","A northern route adds diversity, though drought can reduce regional hydropower.",64,450000000,550000000]
    ],
    [
      ["botswana-south-africa-upgrade","geo-gaborone-south-african-market","Gaborone border upgrade","EXISTING",300000000,155000000,3100000,1,39,0.018,0.08],
      ["botswana-zimbabwe-upgrade","geo-gaborone-zimbabwe-market","Northern border upgrade","EXISTING",250000000,150000000,3000000,2,39,0.018,0.08]
    ]
  ],
  "geo-windhoek": [
    [
      ["geo-windhoek-south-african-market","South Africa","The southern connection supports a small, dry grid, while Namibian solar can create daytime export opportunities.",67,750000000,800000000],
      ["geo-windhoek-zambia-zimbabwe-market","Zambia and Zimbabwe","A northern path reaches reservoir hydropower, but long distances and drought limit dependable supply.",61,450000000,500000000]
    ],
    [
      ["namibia-south-africa-upgrade","geo-windhoek-south-african-market","Kokerboom corridor upgrade","EXISTING",350000000,180000000,3600000,2,39,0.018,0.08],
      ["namibia-north-upgrade","geo-windhoek-zambia-zimbabwe-market","Caprivi trading-path upgrade","EXISTING",250000000,175000000,3500000,2,40,0.019,0.08]
    ]
  ],
  "geo-johannesburg": [
    [
      ["geo-johannesburg-mozambique-market","Mozambique","Cahora Bassa hydropower can move south, while South African surplus can support Maputo.",58,1200000000,900000000],
      ["geo-johannesburg-northwest-pool","Botswana and Namibia","Smaller dry-climate neighbours often import, but daytime solar can sometimes reverse the flow.",65,750000000,950000000]
    ],
    [
      ["south-africa-mozambique-upgrade","geo-johannesburg-mozambique-market","Mozambique corridor upgrade","EXISTING",650000000,260000000,5200000,2,34,0.014,0.04],
      ["south-africa-northwest-upgrade","geo-johannesburg-northwest-pool","Northwest border upgrade","EXISTING",450000000,210000000,4200000,2,35,0.015,0.05]
    ]
  ],
  "geo-delhi": [
    [
      ["geo-delhi-himalayan-hydro-market","Nepal and Bhutan hydropower","Mountain rivers can send low-carbon power in wet months; winter and dry-season flows can be smaller.",43,1200000000,700000000],
      ["geo-delhi-bangladesh-market","Bangladesh","A fast-growing neighbouring grid usually buys power, but a two-way market can share reserves during an emergency.",67,700000000,1300000000]
    ],
    [
      ["india-himalaya-upgrade","geo-delhi-himalayan-hydro-market","Himalayan border upgrade","EXISTING",700000000,280000000,5600000,2,35,0.014,0.05],
      ["india-bangladesh-upgrade","geo-delhi-bangladesh-market","Eastern border upgrade","EXISTING",700000000,300000000,6000000,2,37,0.016,0.06]
    ]
  ],
  "geo-karachi": [
    [
      ["geo-karachi-central-asian-hydro","Central Asian hydropower","CASA-1000 is designed to bring summer hydropower through Afghanistan when Pakistan's cooling demand is high.",46,1000000000,500000000]
    ],
    [
      ["pakistan-casa","geo-karachi-central-asian-hydro","CASA-1000 connection","NEW",800000000,620000000,11000000,4,40,0.018,0.07]
    ]
  ],
  "geo-dhaka": [
    [
      ["geo-dhaka-india-west-market","Eastern India","Large Indian power stations and exchanges can supply Bangladesh through the western border.",61,1100000000,900000000],
      ["geo-dhaka-india-tripura-market","Tripura and northeast India","A smaller eastern connection provides another source, especially useful nearer Chittagong.",64,300000000,350000000]
    ],
    [
      ["bangladesh-bheramara-upgrade","geo-dhaka-india-west-market","Bheramara border upgrade","EXISTING",600000000,260000000,5200000,2,35,0.015,0.05],
      ["bangladesh-tripura-upgrade","geo-dhaka-india-tripura-market","Cumilla border upgrade","EXISTING",150000000,120000000,2400000,1,35,0.015,0.05]
    ]
  ],
  "geo-kathmandu": [
    [
      ["geo-kathmandu-indian-market","India","India can supply Nepal in a dry-season shortage and buy Nepalese hydropower when rivers are high.",57,1100000000,1100000000],
      ["geo-kathmandu-bangladesh-via-india","Bangladesh through India","A three-country trade route lets Nepalese hydropower reach Bangladesh using India's grid.",65,250000000,450000000]
    ],
    [
      ["nepal-india-upgrade","geo-kathmandu-indian-market","Dhalkebar border upgrade","EXISTING",600000000,250000000,5000000,2,32,0.012,0.04],
      ["nepal-bangladesh-upgrade","geo-kathmandu-bangladesh-via-india","Three-country trade upgrade","EXISTING",150000000,120000000,2400000,2,33,0.013,0.04]
    ]
  ],
  "jp-east": [
    [
      ["jp-east-tohoku-grid","Tohoku","Northern wind and thermal power can support Tokyo when the regional tie has room.",54,1400000000,900000000],
      ["jp-east-chubu-grid","Chubu (60 Hz)","Frequency converters bridge eastern Japan's 50 Hz grid and western Japan's 60 Hz grid.",60,1000000000,1100000000]
    ],
    [
      ["tohoku-tokyo-upgrade","jp-east-tohoku-grid","Tohoku connection","EXISTING",900000000,280000000,5600000,2,28,0.01,0.03],
      ["tokyo-chubu-frequency","jp-east-chubu-grid","Chubu (60 Hz) connection","EXISTING",650000000,440000000,7500000,3,30,0.012,0.04]
    ]
  ],
  "jp-kansai": [
    [
      ["jp-kansai-chubu-grid","Chubu","Move power between two large 60 Hz regions when prices and reserves differ.",59,1100000000,1200000000],
      ["jp-kansai-chugoku-grid","Chugoku","A western reinforcement opens another path for backup and surplus power.",56,900000000,700000000]
    ],
    [
      ["kansai-chubu-reinforcement","jp-kansai-chubu-grid","Chubu connection","EXISTING",800000000,240000000,4800000,2,30,0.012,0.04],
      ["kansai-chugoku-reinforcement","jp-kansai-chugoku-grid","Chugoku connection","EXISTING",600000000,210000000,4200000,2,30,0.012,0.04]
    ]
  ],
  "jp-hokkaido": [
    [
      ["jp-hokkaido-tohoku-grid","Northern Honshu","Share Hokkaido wind and Honshu backup power through the undersea link.",52,900000000,700000000]
    ],
    [
      ["hokkaido-honshu-reinforcement","jp-hokkaido-tohoku-grid","Northern Honshu connection","EXISTING",500000000,360000000,6000000,2,35,0.005,0.01]
    ]
  ],
  "jp-kyushu": [
    [
      ["jp-kyushu-chugoku-grid","Chugoku","Strengthen Kyushu's existing connection across the Kanmon Strait.",57,850000000,750000000]
    ],
    [
      ["kyushu-kanmon-reinforcement","jp-kyushu-chugoku-grid","Chugoku connection","EXISTING",500000000,220000000,4400000,2,30,0.012,0.04]
    ]
  ],
  "jp-chubu": [
    [
      ["jp-chubu-tokyo-grid","Tokyo (50 Hz)","Converters make power exchange possible across Japan's frequency divide.",63,1200000000,1500000000],
      ["jp-chubu-kansai-grid","Kansai","Reinforce the 60 Hz west-Japan backbone toward Osaka.",58,1000000000,1100000000]
    ],
    [
      ["chubu-tokyo-frequency","jp-chubu-tokyo-grid","Tokyo (50 Hz) connection","EXISTING",650000000,440000000,7500000,3,30,0.012,0.04],
      ["chubu-kansai-reinforcement","jp-chubu-kansai-grid","Kansai connection","EXISTING",800000000,240000000,4800000,2,30,0.012,0.04]
    ]
  ],
  "cn-north": [
    [
      ["cn-north-northwest-energy","Northwest wind and solar","Long-distance UHV lines bring western wind and solar toward northern load centers.",43,2000000000,900000000],
      ["cn-north-northeast-grid","Northeast China","A stronger regional seam shares winter reserves between northern systems.",49,1000000000,800000000]
    ],
    [
      ["north-northwest-uhv","cn-north-northwest-energy","Northwest wind and solar connection","EXISTING",1200000000,520000000,9000000,3,28,0.01,0.03],
      ["north-northeast-reinforcement","cn-north-northeast-grid","Northeast China connection","EXISTING",700000000,240000000,4800000,2,28,0.01,0.03]
    ]
  ],
  "cn-east": [
    [
      ["cn-east-southwest-hydro","Southwest hydropower","UHVDC carries large blocks of western hydropower to the east-coast load center.",46,2400000000,800000000],
      ["cn-east-central-china-grid","Central China","Reinforce the interregional AC/DC network that balances inland and coastal demand.",52,1200000000,1100000000]
    ],
    [
      ["east-southwest-uhv","cn-east-southwest-hydro","Southwest hydropower connection","EXISTING",1500000000,620000000,10000000,3,30,0.012,0.04],
      ["east-central-reinforcement","cn-east-central-china-grid","Central China connection","EXISTING",900000000,330000000,6200000,2,30,0.012,0.04]
    ]
  ],
  "cn-south": [
    [
      ["cn-south-southwest-renewables","Yunnan and Guizhou","Hydro-rich western provinces can serve the Pearl River Delta through the Southern Grid.",45,2100000000,800000000],
      ["cn-south-hong-kong-system","Hong Kong system","A limited cross-system link can exchange support with Hong Kong; it is not an international border.",68,600000000,900000000]
    ],
    [
      ["south-yunnan-guizhou-reinforcement","cn-south-southwest-renewables","Yunnan and Guizhou connection","EXISTING",1300000000,430000000,8000000,3,33,0.015,0.06],
      ["guangdong-hong-kong-upgrade","cn-south-hong-kong-system","Hong Kong system connection","EXISTING",500000000,260000000,5000000,2,33,0.015,0.06]
    ]
  ],
  "cn-sichuan": [
    [
      ["cn-sichuan-east-china-grid","East China","Export southwest hydropower to the dense east-coast grid.",61,900000000,2200000000],
      ["cn-sichuan-xinjiang-renewables","Xinjiang renewables","A long-distance HVDC route brings western wind and solar into Chongqing.",44,1800000000,700000000]
    ],
    [
      ["sichuan-east-uhv","cn-sichuan-east-china-grid","East China connection","EXISTING",1500000000,620000000,10000000,3,30,0.012,0.04],
      ["xinjiang-chongqing-uhv","cn-sichuan-xinjiang-renewables","Xinjiang renewables connection","EXISTING",1000000000,580000000,9500000,3,26,0.01,0.08]
    ]
  ],
  "cn-central": [
    [
      ["cn-central-north-china-grid","North China","Use the interregional UHV mesh to share reserves north of Wuhan.",54,1100000000,1200000000],
      ["cn-central-southwest-hydro","Southwest hydropower","Western hydro can cover central-China peaks when river conditions allow.",46,1800000000,700000000]
    ],
    [
      ["central-north-uhv","cn-central-north-china-grid","North China connection","EXISTING",850000000,310000000,6000000,2,30,0.012,0.04],
      ["central-southwest-uhv","cn-central-southwest-hydro","Southwest hydropower connection","EXISTING",1000000000,390000000,7000000,3,30,0.012,0.04]
    ]
  ],
  "cn-northwest": [
    [
      ["cn-northwest-central-china-grid","Central China","Send northwest wind, solar, and thermal output toward inland demand centers.",58,800000000,1700000000]
    ],
    [
      ["northwest-central-uhv","cn-northwest-central-china-grid","Central China connection","EXISTING",1100000000,480000000,8500000,3,28,0.01,0.03]
    ]
  ],
  "cn-northeast": [
    [
      ["cn-northeast-north-china-grid","North China","Move northern winter reserves toward Beijing through the domestic regional seam.",55,800000000,1100000000],
      ["cn-northeast-russian-far-east","Russian Far East","A converter-backed border route can import hydro and thermal power from the Russian Far East.",50,900000000,500000000]
    ],
    [
      ["northeast-north-reinforcement","cn-northeast-north-china-grid","North China connection","EXISTING",700000000,260000000,5000000,2,28,0.01,0.03],
      ["heilongjiang-russia-upgrade","cn-northeast-russian-far-east","Russian Far East connection","EXISTING",500000000,340000000,6000000,3,28,0.01,0.03]
    ]
  ],
  "cn-xinjiang": [
    [
      ["cn-xinjiang-chongqing-grid","Chongqing","A very long UHVDC corridor exports desert wind and solar to southwest demand.",60,700000000,1700000000],
      ["cn-xinjiang-east-china-grid","East China","Add another long-haul outlet for western renewable surpluses.",66,700000000,2000000000]
    ],
    [
      ["xinjiang-chongqing-export","cn-xinjiang-chongqing-grid","Chongqing connection","EXISTING",1200000000,650000000,10500000,3,26,0.01,0.08],
      ["xinjiang-east-expansion","cn-xinjiang-east-china-grid","East China connection","NEW",1500000000,950000000,14000000,5,26,0.01,0.08]
    ]
  ],
  "cn-xizang": [
    [
      ["cn-xizang-qinghai-grid","Qinghai","Reinforce the high-altitude line linking the plateau to China's wider grid.",48,600000000,450000000],
      ["cn-xizang-sichuan-grid","Sichuan","A second mountain route adds support from the east.",52,700000000,500000000]
    ],
    [
      ["qinghai-xizang-reinforcement","cn-xizang-qinghai-grid","Qinghai connection","EXISTING",350000000,300000000,5200000,3,26,0.01,0.08],
      ["sichuan-xizang-reinforcement","cn-xizang-sichuan-grid","Sichuan connection","EXISTING",300000000,340000000,5800000,4,26,0.01,0.08]
    ]
  ],
  "hk-mainland": [
    [
      ["hk-mainland-guangdong-grid","Guangdong grid","Expand Hong Kong's limited mainland connection for cleaner imports and emergency support.",57,1200000000,700000000],
      ["hk-mainland-mainland-clean-power","Mainland clean power","Build a dedicated new circuit for additional low-carbon electricity.",54,1500000000,500000000]
    ],
    [
      ["hong-kong-guangdong-upgrade","hk-mainland-guangdong-grid","Guangdong grid connection","EXISTING",600000000,320000000,6000000,3,33,0.015,0.06],
      ["hong-kong-mainland-new-link","hk-mainland-mainland-clean-power","Mainland clean power connection","NEW",800000000,780000000,10000000,5,35,0.005,0.01]
    ]
  ],
  "mn-central": [
    [
      ["mn-central-russian-siberia","Russian Siberia","Imported Russian power covers winter peaks in Mongolia's Central Energy System.",50,500000000,350000000]
    ],
    [
      ["mongolia-russia-reinforcement","mn-central-russian-siberia","Russian Siberia connection","EXISTING",300000000,190000000,3800000,2,28,0.01,0.03]
    ]
  ],
  "ru-far-east": [
    [
      ["ru-far-east-northeast-china","Northeast China","A converter station links the Far East system with China without synchronizing both grids.",56,800000000,1200000000],
      ["ru-far-east-siberia-grid","Siberia","Strengthen the constrained seam between Russia's separate East and Siberia synchronous zones.",49,1000000000,700000000]
    ],
    [
      ["far-east-china-upgrade","ru-far-east-northeast-china","Northeast China connection","EXISTING",500000000,330000000,6000000,3,28,0.01,0.03],
      ["far-east-siberia-converter","ru-far-east-siberia-grid","Siberia connection","NEW",600000000,620000000,9000000,4,28,0.01,0.03]
    ]
  ],
  "ru-siberia": [
    [
      ["ru-siberia-urals-grid","Urals grid","Reinforce the westbound route that balances Siberian hydro with the wider unified system.",57,1100000000,1300000000],
      ["ru-siberia-far-east-grid","Russian Far East","A controlled new seam can share reserves without assuming normal synchronous operation.",55,700000000,900000000]
    ],
    [
      ["siberia-urals-reinforcement","ru-siberia-urals-grid","Urals grid connection","EXISTING",900000000,350000000,6500000,3,28,0.01,0.03],
      ["siberia-far-east-converter","ru-siberia-far-east-grid","Russian Far East connection","NEW",600000000,620000000,9000000,4,28,0.01,0.03]
    ]
  ],
  "ru-yakutia": [
    [
      ["ru-yakutia-south-yakutia","South Yakutia","Reinforce the long internal route joining central Yakutia to the Far East system.",58,450000000,350000000]
    ],
    [
      ["yakutia-south-reinforcement","ru-yakutia-south-yakutia","South Yakutia connection","EXISTING",350000000,310000000,5500000,3,28,0.01,0.03]
    ]
  ],
  "th-central": [
    [
      ["th-central-laos-hydro","Lao hydropower","Laos can export hydro to Thailand, while the same network supports wider regional trading.",45,1500000000,500000000],
      ["th-central-peninsular-malaysia","Peninsular Malaysia","The controllable HVDC border link trades power south toward Malaysia.",59,500000000,600000000]
    ],
    [
      ["thailand-laos-reinforcement","th-central-laos-hydro","Lao hydropower connection","EXISTING",900000000,280000000,5500000,2,33,0.015,0.06],
      ["thailand-malaysia-hvdc","th-central-peninsular-malaysia","Peninsular Malaysia connection","EXISTING",300000000,220000000,4200000,2,33,0.015,0.06]
    ]
  ],
  "th-north": [
    [
      ["th-north-northern-laos","Northern Laos","A nearby cross-border line exchanges hydro and dry-season backup.",47,500000000,300000000],
      ["th-north-central-thailand","Central Thailand","Reinforce the domestic path from the northern region to Thailand's main load center.",61,400000000,700000000]
    ],
    [
      ["north-thailand-laos","th-north-northern-laos","Northern Laos connection","EXISTING",300000000,150000000,3000000,2,33,0.015,0.06],
      ["north-thailand-central-upgrade","th-north-central-thailand","Central Thailand connection","EXISTING",450000000,180000000,3600000,2,33,0.015,0.06]
    ]
  ],
  "vn-south": [
    [
      ["vn-south-cambodia-grid","Cambodia","The Chau Doc-Takeo corridor mostly carries Vietnamese power toward Cambodia.",66,350000000,550000000],
      ["vn-south-north-vietnam-grid","Northern Vietnam","Reinforce the long domestic 500 kV backbone between northern supply and southern demand.",58,900000000,1100000000]
    ],
    [
      ["vietnam-cambodia-upgrade","vn-south-cambodia-grid","Cambodia connection","EXISTING",300000000,170000000,3200000,2,33,0.015,0.06],
      ["vietnam-north-south-reinforcement","vn-south-north-vietnam-grid","Northern Vietnam connection","EXISTING",800000000,320000000,6000000,3,33,0.015,0.06]
    ]
  ],
  "vn-north": [
    [
      ["vn-north-yunnan-grid","Yunnan grid","Existing northern border lines import power from China when Vietnam needs it.",53,800000000,600000000],
      ["vn-north-northern-laos","Northern Laos","Mountain hydro and wind enter Vietnam through growing Laos interconnections.",47,700000000,350000000]
    ],
    [
      ["vietnam-china-upgrade","vn-north-yunnan-grid","Yunnan grid connection","EXISTING",500000000,210000000,4000000,2,33,0.015,0.06],
      ["north-vietnam-laos","vn-north-northern-laos","Northern Laos connection","EXISTING",450000000,230000000,4300000,3,33,0.015,0.06]
    ]
  ],
  "kh-national": [
    [
      ["kh-national-southern-vietnam","Southern Vietnam","Vietnamese imports support Phnom Penh through the existing 230 kV route.",57,700000000,400000000],
      ["kh-national-laos-hydro","Lao hydropower","A northern border route brings hydropower into Cambodia.",48,600000000,250000000]
    ],
    [
      ["cambodia-vietnam-reinforcement","kh-national-southern-vietnam","Southern Vietnam connection","EXISTING",350000000,180000000,3400000,2,33,0.015,0.06],
      ["cambodia-laos-reinforcement","kh-national-laos-hydro","Lao hydropower connection","EXISTING",300000000,190000000,3500000,2,33,0.015,0.06]
    ]
  ],
  "la-national": [
    [
      ["la-national-thailand-grid","Thailand","Export hydropower in wet periods and import support during dry-season shortages.",60,650000000,1200000000],
      ["la-national-vietnam-grid","Vietnam","Newer high-voltage routes carry Lao wind and hydro east to Vietnam.",58,600000000,1000000000]
    ],
    [
      ["laos-thailand-reinforcement","la-national-thailand-grid","Thailand connection","EXISTING",800000000,260000000,5000000,2,33,0.015,0.06],
      ["laos-vietnam-reinforcement","la-national-vietnam-grid","Vietnam connection","EXISTING",600000000,300000000,5600000,3,33,0.015,0.06]
    ]
  ],
  "mm-national": [
    [
      ["mm-national-thailand-grid","Thailand","Build a first bulk grid-to-grid route toward Thailand; today this remains a regional plan.",59,800000000,700000000],
      ["mm-national-central-myanmar","Central Myanmar","Strengthen the domestic 230 kV backbone before relying on cross-border trade.",54,500000000,600000000]
    ],
    [
      ["myanmar-thailand-new-link","mm-national-thailand-grid","Thailand connection","NEW",500000000,720000000,9000000,5,33,0.015,0.06],
      ["myanmar-central-backbone","mm-national-central-myanmar","Central Myanmar connection","NEW",400000000,280000000,5000000,3,33,0.015,0.06]
    ]
  ],
  "my-peninsula": [
    [
      ["my-peninsula-thailand-grid","Thailand","A controllable HVDC link and a smaller AC line connect the peninsula northward.",55,650000000,600000000],
      ["my-peninsula-singapore-market","Singapore","Submarine cables exchange emergency support and traded power with Singapore.",78,500000000,1000000000]
    ],
    [
      ["malaysia-thailand-hvdc","my-peninsula-thailand-grid","Thailand connection","EXISTING",380000000,220000000,4200000,2,33,0.015,0.06],
      ["malaysia-singapore-upgrade","my-peninsula-singapore-market","Singapore connection","EXISTING",700000000,330000000,6000000,3,35,0.005,0.01]
    ]
  ],
  "sg-national": [
    [
      ["sg-national-peninsular-malaysia","Peninsular Malaysia","The island's physical interconnector can move power in either direction.",58,1000000000,650000000]
    ],
    [
      ["singapore-malaysia-upgrade","sg-national-peninsular-malaysia","Peninsular Malaysia connection","EXISTING",700000000,330000000,6000000,3,35,0.005,0.01]
    ]
  ],
  "id-java": [
    [
      ["id-java-bali-grid","Bali grid","Reinforce the domestic submarine cables that tie Bali into the Java-Bali system.",72,300000000,450000000],
      ["id-java-sumatra-grid","Sumatra grid","Build the long-planned domestic HVDC bridge across the Sunda Strait.",49,1400000000,700000000]
    ],
    [
      ["java-bali-reinforcement","id-java-bali-grid","Bali grid connection","EXISTING",350000000,260000000,4800000,3,35,0.005,0.01],
      ["java-sumatra-hvdc","id-java-sumatra-grid","Sumatra grid connection","NEW",900000000,1200000000,16000000,6,35,0.005,0.01]
    ]
  ],
  "id-bali": [
    [
      ["id-bali-java-grid","Java grid","Upgrade the existing domestic submarine connection that supplies part of Bali's demand.",54,900000000,500000000]
    ],
    [
      ["bali-java-reinforcement","id-bali-java-grid","Java grid connection","EXISTING",350000000,260000000,4800000,3,35,0.005,0.01]
    ]
  ],
  "id-sumatra": [
    [
      ["id-sumatra-south-sumatra-grid","South Sumatra","Reinforce the domestic 275 kV backbone moving power between southern resources and northern demand.",50,900000000,500000000],
      ["id-sumatra-peninsular-malaysia","Peninsular Malaysia","Build the proposed cross-strait HVDC connection to Malaysia.",60,700000000,650000000]
    ],
    [
      ["sumatra-backbone-reinforcement","id-sumatra-south-sumatra-grid","South Sumatra connection","EXISTING",600000000,280000000,5200000,3,33,0.015,0.06],
      ["sumatra-malaysia-hvdc","id-sumatra-peninsular-malaysia","Peninsular Malaysia connection","NEW",600000000,920000000,12000000,5,35,0.005,0.01]
    ]
  ],
  "ph-luzon": [
    [
      ["ph-luzon-visayas-grid","Visayas grid","Reinforce the domestic submarine path joining Luzon and the Visayas.",61,550000000,500000000]
    ],
    [
      ["luzon-visayas-reinforcement","ph-luzon-visayas-grid","Visayas grid connection","EXISTING",450000000,330000000,6000000,3,35,0.005,0.01]
    ]
  ],
  "ph-visayas": [
    [
      ["ph-visayas-luzon-grid","Luzon grid","Share generation and reserves with the country's largest demand center.",66,700000000,900000000],
      ["ph-visayas-mindanao-grid","Mindanao grid","Expand the new domestic HVDC link between the Visayas and Mindanao.",55,650000000,450000000]
    ],
    [
      ["visayas-luzon-reinforcement","ph-visayas-luzon-grid","Luzon grid connection","EXISTING",450000000,330000000,6000000,3,35,0.005,0.01],
      ["visayas-mindanao-reinforcement","ph-visayas-mindanao-grid","Mindanao grid connection","EXISTING",450000000,300000000,5500000,3,35,0.005,0.01]
    ]
  ],
  "ph-mindanao": [
    [
      ["ph-mindanao-visayas-grid","Visayas grid","Use the domestic HVDC link to share Mindanao power with the rest of the unified Philippine grid.",62,550000000,600000000],
      ["ph-mindanao-sabah-grid","Sabah grid","Build a future international cable toward Malaysian Borneo.",58,650000000,500000000]
    ],
    [
      ["mindanao-visayas-reinforcement","ph-mindanao-visayas-grid","Visayas grid connection","EXISTING",450000000,300000000,5500000,3,35,0.005,0.01],
      ["mindanao-sabah-link","ph-mindanao-sabah-grid","Sabah grid connection","NEW",500000000,1050000000,13000000,6,35,0.005,0.01]
    ]
  ],
  "bn-proposed": [
    [
      ["bn-proposed-sarawak-hydro","Sarawak hydropower","Build Brunei's planned first cross-border power connection to Sarawak.",50,500000000,250000000]
    ],
    [
      ["brunei-sarawak-link","bn-proposed-sarawak-hydro","Sarawak hydropower connection","NEW",250000000,520000000,7000000,4,33,0.015,0.06]
    ]
  ],
  "co-national": [
    [
      ["co-national-ecuador-market","Ecuador","Mountain hydropower can flow either way when rain and demand differ across the border.",58,650000000,550000000]
    ],
    [
      ["co-ecuador-upgrade","co-national-ecuador-market","Ecuador mountain link","EXISTING",450000000,190000000,3800000,2,26,0.01,0.08]
    ]
  ],
  "ve-reconnection": [
    [
      ["ve-reconnection-colombia-restart-market","Colombia (dormant connection)","The wires exist, but regular trading stopped. Reopening them creates a fragile new source of backup power.",66,300000000,350000000]
    ],
    [
      ["ve-colombia-reactivation","ve-reconnection-colombia-restart-market","Restart the Colombia link","EXISTING",250000000,240000000,4800000,3,34,0.018,0.08]
    ]
  ],
  "ec-national": [
    [
      ["ec-national-colombia-market","Colombia","A working Andean market can provide hydro backup or buy Ecuador's surplus.",60,600000000,650000000],
      ["ec-national-peru-market","Peru","Peru's gas and hydro mix complements Ecuador's rain-driven system.",64,500000000,550000000]
    ],
    [
      ["ec-colombia-upgrade","ec-national-colombia-market","Northern Andean upgrade","EXISTING",450000000,190000000,3800000,2,26,0.01,0.08],
      ["ec-peru-500kv","ec-national-peru-market","Ecuador-Peru 500 kV backbone","NEW",500000000,520000000,9000000,4,33,0.015,0.06]
    ]
  ],
  "pe-national": [
    [
      ["pe-national-ecuador-market-pe","Ecuador","Northern exchanges connect Peru to Ecuador today; a stronger Andean backbone can carry more.",59,450000000,500000000],
      ["pe-national-bolivia-market-pe","Bolivia (proposed)","A new highland route could trade Bolivian gas and hydro power with Peru.",55,350000000,300000000]
    ],
    [
      ["pe-ecuador-upgrade","pe-national-ecuador-market-pe","Northern border upgrade","EXISTING",250000000,210000000,4200000,2,33,0.015,0.06],
      ["pe-bolivia-sinea","pe-national-bolivia-market-pe","Peru-Bolivia highland line","NEW",350000000,480000000,8000000,4,26,0.01,0.08]
    ]
  ],
  "bo-national": [
    [
      ["bo-national-argentina-market-bo","Argentina","The Juana Azurduy line lets Bolivia export generation to northern Argentina.",57,300000000,450000000],
      ["bo-national-peru-market-bo","Peru (proposed)","A future Andean connection could balance dry-season shortages between the two highland grids.",60,300000000,350000000]
    ],
    [
      ["bo-argentina-upgrade","bo-national-argentina-market-bo","Juana Azurduy upgrade","EXISTING",200000000,150000000,3000000,2,26,0.01,0.08],
      ["bo-peru-sinea","bo-national-peru-market-bo","Lake Titicaca connection","NEW",300000000,410000000,7000000,4,26,0.01,0.08]
    ]
  ],
  "cl-national": [
    [
      ["cl-national-argentina-market-cl","Argentina","The Andes-Salta route can move power across the mountains when the two systems coordinate.",61,350000000,450000000],
      ["cl-national-peru-market-cl","Peru (proposed)","A northern line would extend the Andean power corridor.",58,400000000,350000000]
    ],
    [
      ["cl-argentina-andes","cl-national-argentina-market-cl","Andes-Salta reinforcement","EXISTING",300000000,250000000,5000000,3,26,0.01,0.08],
      ["cl-peru-sinea","cl-national-peru-market-cl","Chile-Peru northern line","NEW",400000000,560000000,9500000,4,26,0.01,0.08]
    ]
  ],
  "ar-east": [
    [
      ["ar-east-uruguay-market-ar","Uruguay","A tightly coordinated 50 Hz neighbour can buy surplus or provide fast regional backup.",56,800000000,700000000],
      ["ar-east-brazil-market-ar","Southern Brazil","Frequency converters bridge Argentina's 50 Hz system and Brazil's 60 Hz grid.",59,900000000,850000000]
    ],
    [
      ["ar-uruguay-upgrade","ar-east-uruguay-market-ar","Salto Grande corridor upgrade","EXISTING",600000000,220000000,4400000,2,30,0.012,0.04],
      ["ar-brazil-garabi","ar-east-brazil-market-ar","Garabi converter upgrade","EXISTING",650000000,310000000,6200000,3,33,0.015,0.06]
    ]
  ],
  "ar-west": [
    [
      ["ar-west-chile-market-ar","Chile","A mountain route links Argentina's gas-backed power with Chile's long north-south grid.",63,400000000,450000000],
      ["ar-west-bolivia-market-ar","Bolivia","Northern Argentina can receive power over the Juana Azurduy line.",55,300000000,350000000]
    ],
    [
      ["ar-chile-andes","ar-west-chile-market-ar","Andes-Salta reinforcement","EXISTING",300000000,250000000,5000000,3,26,0.01,0.08],
      ["ar-bolivia-upgrade","ar-west-bolivia-market-ar","Bolivia border upgrade","EXISTING",200000000,150000000,3000000,2,26,0.01,0.08]
    ]
  ],
  "uy-national": [
    [
      ["uy-national-argentina-market-uy","Argentina","Three connection points share reserves and energy with Argentina's much larger 50 Hz system.",58,800000000,900000000],
      ["uy-national-brazil-market-uy","Southern Brazil","Converters let Uruguay's 50 Hz grid exchange power with Brazil's 60 Hz grid.",60,650000000,700000000]
    ],
    [
      ["uy-argentina-upgrade","uy-national-argentina-market-uy","Argentina intertie upgrade","EXISTING",600000000,210000000,4200000,2,30,0.012,0.04],
      ["uy-brazil-melo","uy-national-brazil-market-uy","Melo converter upgrade","EXISTING",450000000,260000000,5200000,2,33,0.015,0.06]
    ]
  ],
  "py-national": [
    [
      ["py-national-brazil-market-py","Brazil","Itaipu's two frequencies physically join Paraguay and Brazil, with room for regional sales.",53,900000000,1000000000],
      ["py-national-argentina-market-py","Argentina","Yacyreta links Paraguay's hydro system to Argentina.",55,700000000,850000000]
    ],
    [
      ["py-brazil-itaipu","py-national-brazil-market-py","Itaipu connection upgrade","EXISTING",650000000,260000000,5200000,2,33,0.015,0.06],
      ["py-argentina-yacyreta","py-national-argentina-market-py","Yacyreta connection upgrade","EXISTING",500000000,230000000,4600000,2,33,0.015,0.06]
    ]
  ],
  "br-seco": [
    [
      ["br-seco-br-south-market","Southern Brazil","Wind, hydro, and demand differ across the South and Southeast, creating two-way trade.",57,1200000000,1300000000],
      ["br-seco-br-northeast-market","Northeast Brazil","Strong wind and solar can flow south; dry or still weather can reverse the exchange.",54,1300000000,1100000000]
    ],
    [
      ["br-seco-south-upgrade","br-seco-br-south-market","South-Southeast backbone","EXISTING",800000000,260000000,5200000,2,33,0.015,0.06],
      ["br-seco-ne-upgrade","br-seco-br-northeast-market","Northeast-Southeast backbone","EXISTING",850000000,310000000,6200000,3,33,0.015,0.06]
    ]
  ],
  "br-ne": [
    [
      ["br-ne-br-seco-market","Southeast and Centre-West Brazil","The country's largest demand centre can buy Northeast renewable surplus or send backup north.",61,1400000000,1500000000],
      ["br-ne-br-north-market","Northern Brazil","Hydro and long-distance renewable flows connect the North and Northeast.",55,1000000000,900000000]
    ],
    [
      ["br-ne-seco-upgrade","br-ne-br-seco-market","Northeast-Southeast reinforcement","EXISTING",850000000,310000000,6200000,3,33,0.015,0.06],
      ["br-ne-north-upgrade","br-ne-br-north-market","North-Northeast reinforcement","EXISTING",650000000,250000000,5000000,2,34,0.018,0.08]
    ]
  ],
  "br-north": [
    [
      ["br-north-br-seco-market-north","Southeast and Centre-West Brazil","Long transmission routes share northern hydro with the country's main demand centre.",60,1100000000,1400000000],
      ["br-north-br-ne-market-north","Northeast Brazil","A regional seam balances Amazon hydro against Northeast wind, solar, and demand.",56,900000000,1000000000]
    ],
    [
      ["br-north-seco-upgrade","br-north-br-seco-market-north","North-Southeast trunk upgrade","EXISTING",750000000,340000000,6800000,3,34,0.018,0.08],
      ["br-north-ne-upgrade","br-north-br-ne-market-north","North-Northeast trunk upgrade","EXISTING",600000000,270000000,5400000,3,34,0.018,0.08]
    ]
  ],
  "br-south": [
    [
      ["br-south-argentina-market-br","Argentina","Garabi and Uruguaiana converters bridge Brazil's 60 Hz grid and Argentina's 50 Hz system.",58,850000000,900000000],
      ["br-south-uruguay-market-br","Uruguay","Melo and Rivera converters support two-way trade with Uruguay.",56,650000000,650000000]
    ],
    [
      ["br-argentina-garabi","br-south-argentina-market-br","Garabi converter upgrade","EXISTING",650000000,310000000,6200000,3,33,0.015,0.06],
      ["br-uruguay-melo","br-south-uruguay-market-br","Melo-Rivera upgrade","EXISTING",450000000,260000000,5200000,2,33,0.015,0.06]
    ]
  ],
  "au-nsw": [
    [
      ["au-nsw-queensland-market","Queensland","Solar-rich Queensland and New South Wales share power over two northern links.",55,1200000000,1300000000],
      ["au-nsw-victoria-market","Victoria","The Snowy and Murray network moves power between two large NEM regions.",58,1300000000,1400000000]
    ],
    [
      ["au-nsw-qld-upgrade","au-nsw-queensland-market","Queensland-NSW upgrade","EXISTING",700000000,250000000,5000000,2,33,0.015,0.06],
      ["au-nsw-vic-upgrade","au-nsw-victoria-market","Victoria-NSW upgrade","EXISTING",800000000,280000000,5600000,2,30,0.012,0.04]
    ]
  ],
  "au-vic": [
    [
      ["au-vic-nsw-market-vic","New South Wales","Snowy hydro and large city demand make this a busy two-way NEM seam.",57,1300000000,1400000000],
      ["au-vic-tasmania-market-vic","Tasmania","Basslink carries Tasmanian hydro north and mainland backup south.",53,550000000,500000000]
    ],
    [
      ["au-vic-nsw-upgrade","au-vic-nsw-market-vic","Victoria-NSW upgrade","EXISTING",800000000,280000000,5600000,2,30,0.012,0.04],
      ["au-vic-tas-basslink","au-vic-tasmania-market-vic","Basslink upgrade","EXISTING",450000000,390000000,6500000,3,35,0.005,0.01]
    ]
  ],
  "au-qld": [
    [
      ["au-qld-nsw-market-qld","New South Wales","Two links let Queensland's solar and thermal fleet trade with New South Wales.",59,1300000000,1400000000]
    ],
    [
      ["au-qld-nsw-qni","au-qld-nsw-market-qld","Queensland-NSW upgrade","EXISTING",700000000,250000000,5000000,2,33,0.015,0.06]
    ]
  ],
  "au-sa": [
    [
      ["au-sa-victoria-market-sa","Victoria","Heywood and Murraylink connect South Australian wind and solar with Victoria.",58,800000000,900000000],
      ["au-sa-nsw-market-sa","New South Wales","EnergyConnect adds another route for sharing renewable power and reserves.",57,700000000,850000000]
    ],
    [
      ["au-sa-vic-upgrade","au-sa-victoria-market-sa","Victoria intertie upgrade","EXISTING",500000000,240000000,4800000,2,33,0.015,0.06],
      ["au-sa-nsw-energyconnect","au-sa-nsw-market-sa","EnergyConnect expansion","EXISTING",500000000,310000000,6200000,3,33,0.015,0.06]
    ]
  ],
  "au-tas": [
    [
      ["au-tas-victoria-market-tas","Victoria","Basslink exports hydro when Tasmania is wet and imports mainland power when local supply is tight.",60,500000000,550000000]
    ],
    [
      ["au-tas-vic-basslink","au-tas-victoria-market-tas","Basslink upgrade","EXISTING",450000000,390000000,6500000,3,35,0.005,0.01]
    ]
  ],
  "nz-north": [
    [
      ["nz-north-nz-south-market","South Island","South Island hydro often flows north; dry years can send North Island generation south.",51,900000000,700000000]
    ],
    [
      ["nz-north-cook-strait","nz-north-nz-south-market","Cook Strait HVDC upgrade","EXISTING",650000000,430000000,7000000,3,35,0.005,0.01]
    ]
  ],
  "nz-south": [
    [
      ["nz-south-nz-north-market","North Island","The larger northern market buys southern hydro and sends backup south in dry years.",59,800000000,1000000000]
    ],
    [
      ["nz-south-cook-strait","nz-south-nz-north-market","Cook Strait HVDC upgrade","EXISTING",650000000,430000000,7000000,3,35,0.005,0.01]
    ]
  ]
} as const satisfies Readonly<Record<string, TransmissionProfileTuple>>;

// prettier-ignore
export const TRANSMISSION_PROFILE_LOCATION_IDS = {
  "us-ca-wecc": ["SF","LA","SanDiego","Fresno","Sacramento","CAMountains"],
  "us-pjm": ["PIT","Philadelphia","Manassas","Columbus","Baltimore","Cleveland","Chicago","AlleghenyUpper"],
  "us-nyiso": ["NewYork","Buffalo"],
  "us-isone": ["Boston"],
  "us-miso-north": ["Indianapolis","Detroit","Milwaukee","Minneapolis","StLouis"],
  "us-miso-south": ["NewOrleans"],
  "us-spp": ["KansasCity"],
  "us-tva": ["Nashville","Memphis"],
  "us-carolinas": ["Charlotte"],
  "us-southeast": ["Atlanta"],
  "us-florida": ["Jacksonville","Miami"],
  "us-ercot": ["Houston","SanAntonio","Dallas","Austin"],
  "us-pnw-wecc": ["Seattle","Portland"],
  "us-desert-wecc": ["Phoenix","Tucson","LasVegas"],
  "us-rockies-wecc": ["Denver","Albuquerque","SaltLakeCity"],
  "ca-ontario": ["Toronto"],
  "ca-quebec": ["Montreal"],
  "ca-bc": ["Vancouver"],
  "ca-alberta": ["Calgary"],
  "ca-manitoba": ["Winnipeg"],
  "ca-maritimes": ["Halifax"],
  "mx-sin-central-west": ["MexicoCity","Guadalajara"],
  "mx-sin-northeast": ["Monterrey"],
  "mx-baja-wecc": ["Tijuana"],
  "mx-sin-yucatan": ["Cancun"],
  "siepac-north": ["GuatemalaCity"],
  "siepac-central": ["Tegucigalpa","Managua"],
  "siepac-south": ["PanamaCity"],
  "siepac-san-salvador": ["SanSalvador"],
  "siepac-costa-rica": ["SanJoseCR"],
  "geo-london": ["London","Manchester","Edinburgh"],
  "geo-dublin": ["Dublin"],
  "geo-paris": ["Paris","Marseille","Lyon"],
  "geo-madrid": ["Madrid","Barcelona","Seville"],
  "geo-lisbon": ["Lisbon","Porto"],
  "geo-rome": ["Rome","Milan","Naples","Palermo"],
  "geo-berlin": ["Berlin","Munich","Hamburg","Frankfurt","Cologne"],
  "geo-vienna": ["Vienna"],
  "geo-zurich": ["Zurich","Geneva"],
  "geo-amsterdam": ["Amsterdam","Rotterdam"],
  "geo-brussels": ["Brussels"],
  "geo-copenhagen": ["Copenhagen"],
  "geo-lista": ["Lista","Oslo","Bergen","Tromso"],
  "geo-stockholm": ["Stockholm","Gothenburg"],
  "geo-helsinki": ["Helsinki"],
  "geo-warsaw": ["Warsaw","Krakow"],
  "geo-prague": ["Prague"],
  "geo-budapest": ["Budapest"],
  "geo-bucharest": ["Bucharest"],
  "geo-sofia": ["Sofia"],
  "geo-belgrade": ["Belgrade"],
  "geo-zagreb": ["Zagreb"],
  "geo-athens": ["Athens"],
  "geo-kyiv": ["Kyiv"],
  "geo-minsk": ["Minsk"],
  "geo-tallinn": ["Tallinn"],
  "geo-riga": ["Riga"],
  "geo-vilnius": ["Vilnius"],
  "geo-moscow": ["Moscow","StPetersburg","Murmansk"],
  "geo-istanbul": ["Istanbul","Ankara"],
  "geo-dubai": ["Dubai","AbuDhabi"],
  "geo-doha": ["Doha"],
  "geo-manama": ["Manama"],
  "geo-kuwaitcity": ["KuwaitCity"],
  "geo-muscat": ["Muscat"],
  "geo-riyadh": ["Riyadh","Jeddah"],
  "geo-baghdad": ["Baghdad"],
  "geo-tehran": ["Tehran"],
  "geo-amman": ["Amman"],
  "geo-beirut": ["Beirut"],
  "geo-damascus": ["Damascus"],
  "geo-telaviv": ["TelAviv","Jerusalem"],
  "geo-baku": ["Baku"],
  "geo-tbilisi": ["Tbilisi"],
  "geo-yerevan": ["Yerevan"],
  "geo-tashkent": ["Tashkent"],
  "geo-almaty": ["Almaty","Astana"],
  "geo-kabul": ["Kabul"],
  "geo-cairo": ["Cairo","Alexandria"],
  "geo-casablanca": ["Casablanca","Marrakesh"],
  "geo-algiers": ["Algiers"],
  "geo-tunis": ["Tunis"],
  "geo-tripoli": ["Tripoli"],
  "geo-lagos": ["Lagos","Abuja","Kano"],
  "geo-accra": ["Accra"],
  "geo-abidjan": ["Abidjan"],
  "geo-dakar": ["Dakar"],
  "geo-bamako": ["Bamako"],
  "geo-ouagadougou": ["Ouagadougou"],
  "geo-niamey": ["Niamey"],
  "geo-khartoum": ["Khartoum"],
  "geo-addisababa": ["AddisAbaba"],
  "geo-nairobi": ["Nairobi","Mombasa"],
  "geo-kampala": ["Kampala"],
  "geo-kigali": ["Kigali"],
  "geo-daressalaam": ["DarEsSalaam"],
  "geo-kinshasa": ["Kinshasa"],
  "geo-luanda": ["Luanda"],
  "geo-lusaka": ["Lusaka"],
  "geo-harare": ["Harare"],
  "geo-maputo": ["Maputo"],
  "geo-gaborone": ["Gaborone"],
  "geo-windhoek": ["Windhoek"],
  "geo-johannesburg": ["Johannesburg","CapeTown","Durban"],
  "geo-delhi": ["Delhi","Mumbai","Bengaluru","Chennai","Kolkata","Hyderabad","Ahmedabad","Pune","Jaipur","Lucknow"],
  "geo-karachi": ["Karachi","Lahore","Islamabad"],
  "geo-dhaka": ["Dhaka","Chittagong"],
  "geo-kathmandu": ["Kathmandu"],
  "jp-east": ["Tokyo"],
  "jp-kansai": ["Osaka"],
  "jp-hokkaido": ["Sapporo"],
  "jp-kyushu": ["Fukuoka"],
  "jp-chubu": ["Nagoya"],
  "cn-north": ["Beijing"],
  "cn-east": ["Shanghai"],
  "cn-south": ["Guangzhou","Shenzhen"],
  "cn-sichuan": ["Chengdu","Chongqing"],
  "cn-central": ["Wuhan"],
  "cn-northwest": ["Xian"],
  "cn-northeast": ["Harbin"],
  "cn-xinjiang": ["Urumqi"],
  "cn-xizang": ["Lhasa"],
  "hk-mainland": ["HongKong"],
  "mn-central": ["Ulaanbaatar"],
  "ru-far-east": ["Vladivostok"],
  "ru-siberia": ["Novosibirsk"],
  "ru-yakutia": ["Yakutsk"],
  "th-central": ["Bangkok"],
  "th-north": ["ChiangMai"],
  "vn-south": ["HoChiMinhCity"],
  "vn-north": ["Hanoi"],
  "kh-national": ["PhnomPenh"],
  "la-national": ["Vientiane"],
  "mm-national": ["Yangon"],
  "my-peninsula": ["KualaLumpur"],
  "sg-national": ["Singapore"],
  "id-java": ["Jakarta","Surabaya"],
  "id-bali": ["Denpasar"],
  "id-sumatra": ["Medan"],
  "ph-luzon": ["Manila"],
  "ph-visayas": ["Cebu"],
  "ph-mindanao": ["Davao"],
  "bn-proposed": ["BandarSeriBegawan"],
  "co-national": ["Bogota","Medellin"],
  "ve-reconnection": ["Caracas"],
  "ec-national": ["Quito","Guayaquil"],
  "pe-national": ["Lima"],
  "bo-national": ["LaPaz"],
  "cl-national": ["Santiago"],
  "ar-east": ["BuenosAires","Cordoba"],
  "ar-west": ["Mendoza"],
  "uy-national": ["Montevideo"],
  "py-national": ["Asuncion"],
  "br-seco": ["SaoPaulo","RioDeJaneiro","Brasilia"],
  "br-ne": ["Salvador","Fortaleza","Recife"],
  "br-north": ["Manaus","Belem"],
  "br-south": ["PortoAlegre"],
  "au-nsw": ["Sydney","Canberra"],
  "au-vic": ["Melbourne"],
  "au-qld": ["Brisbane"],
  "au-sa": ["Adelaide"],
  "au-tas": ["Hobart"],
  "nz-north": ["Auckland","Wellington"],
  "nz-south": ["Christchurch","Queenstown"]
} as const satisfies Readonly<Record<keyof typeof TRANSMISSION_PROFILE_DATA, readonly string[]>>;

// prettier-ignore
export const NO_INTERTIE_LOCATION_IDS = ["Anchorage","Fairbanks","HNL","SJU","Yellowknife","Iqaluit","Havana","SantoDomingo","PortAuPrince","Kingston","Nassau","Bridgetown","Reykjavik","Antananarivo","PortLouis","Colombo","Male","Seoul","Busan","Taipei","Ushuaia","Georgetown","Paramaribo","Perth","Darwin","AliceSprings","Suva","PortMoresby","Noumea","Papeete","Honiara"] as const;
