/**
 * A cross-platform `Math.pow` for everything that feeds the simulation.
 *
 * V8 evaluates `Math.pow` (and `**`) with the C library's `std::pow`, unlike every other Math
 * function, which it ships its own fdlibm port of. So the last bit of a power depends on the
 * machine: glibc on Linux, the Universal CRT on Windows, Apple's libm on macOS. That is invisible
 * to a player, but a replay or a golden hash is a chain of millions of dependent operations, and a
 * one-ulp difference in a handful of powers was enough to send scenario 108 down a different path
 * on Windows than on Linux CI.
 *
 * This is a line-for-line port of glibc 2.39's `sysdeps/ieee754/dbl-64/e_pow.c` as x86-64 Linux
 * runs it on any FMA-capable CPU (the `__pow_fma` ifunc variant, built with `-mfma -mavx2` and
 * GCC's default `-ffp-contract=fast`): the explicit `__builtin_fma` calls plus every `a * b + c`
 * GCC contracts into a fused multiply-add. Fused multiply-adds are emulated exactly, so the
 * result is bit-for-bit what CI's `Math.pow` returns, and the golden outputs pinned on Linux hold
 * everywhere. Worst-case error is 0.52 ULP, as upstream.
 *
 * Copyright (C) 2018-2024 Free Software Foundation, Inc. (the algorithm and tables), LGPL-2.1+.
 */

// log(x) table: 1/c, log(c) and its tail for each of 128 subintervals (e_pow_log_data.c)
const POW_LOG_TABLE = [
  1.4140625, -0.3464667673462145, 5.929407345889625e-15, 1.40625,
  -0.34092658697056777, -2.544157440035963e-14, 1.3984375, -0.3353555419211034,
  -3.443525940775045e-14, 1.390625, -0.3297532863724655, -2.500123826022799e-15,
  1.3828125, -0.32411946865420305, -8.929337133850617e-15, 1.375,
  -0.31845373111855224, 1.7625431312172662e-14, 1.3671875, -0.31275571000389846,
  1.5688303180062087e-15, 1.359375, -0.3070250352949415, 2.9655274673691784e-14,
  1.3515625, -0.3012613305781997, 3.7923164802093147e-14, 1.34375,
  -0.2954642128938758, 3.993416384387844e-14, 1.3359375, -0.28963329258306203,
  1.9352855826489123e-14, 1.3359375, -0.28963329258306203,
  1.9352855826489123e-14, 1.328125, -0.28376817313062475,
  -1.9852665484979036e-14, 1.3203125, -0.27786845100342816,
  -2.814323765595281e-14, 1.3125, -0.2719337154836694, 2.7643769993528702e-14,
  1.3046875, -0.2659635484970977, -4.025092402293806e-14, 1.296875,
  -0.25995752443691345, -1.2621729398885316e-14, 1.2890625,
  -0.25391520998095984, -3.600176732637335e-15, 1.2890625, -0.25391520998095984,
  -3.600176732637335e-15, 1.28125, -0.2478361639045943, 1.3029797173308663e-14,
  1.2734375, -0.2417199368871934, 4.8230289429940886e-14, 1.265625,
  -0.23556607131274632, -2.0592242769647135e-14, 1.2578125,
  -0.22937410106487732, 3.149265065191484e-14, 1.25, -0.22314355131425145,
  4.169796584527195e-14, 1.25, -0.22314355131425145, 4.169796584527195e-14,
  1.2421875, -0.21687393830063684, 2.2477465222466186e-14, 1.234375,
  -0.21056476910735, 3.6507188831790577e-16, 1.2265625, -0.2042155414286526,
  -3.827767260205414e-14, 1.2265625, -0.2042155414286526,
  -3.827767260205414e-14, 1.21875, -0.19782574332987224,
  -4.7641388950792196e-14, 1.2109375, -0.19139485299967873,
  4.9278276214647115e-14, 1.203125, -0.18492233849406148,
  4.9485167661250996e-14, 1.203125, -0.18492233849406148,
  4.9485167661250996e-14, 1.1953125, -0.1784076574728033,
  -1.5003333854266542e-14, 1.1875, -0.17185025692663203,
  -2.7194441649495324e-14, 1.1875, -0.17185025692663203,
  -2.7194441649495324e-14, 1.1796875, -0.1652495728952772,
  -2.99659267292569e-14, 1.171875, -0.15860503017665906, 2.0472357800461955e-14,
  1.171875, -0.15860503017665906, 2.0472357800461955e-14, 1.1640625,
  -0.15191604202584585, 3.879296723063646e-15, 1.15625, -0.1451820098444614,
  -3.6506824353335045e-14, 1.1484375, -0.13840232285906495,
  -5.4183331379008994e-14, 1.1484375, -0.13840232285906495,
  -5.4183331379008994e-14, 1.140625, -0.131576357788731, 1.1729485484531301e-14,
  1.140625, -0.131576357788731, 1.1729485484531301e-14, 1.1328125,
  -0.12470347850091912, -3.811763084710266e-14, 1.125, -0.11778303565643,
  4.654729747598445e-14, 1.125, -0.11778303565643, 4.654729747598445e-14,
  1.1171875, -0.11081436634026431, -2.5799991283069902e-14, 1.109375,
  -0.10379679368168127, 3.7700471749674615e-14, 1.109375, -0.10379679368168127,
  3.7700471749674615e-14, 1.1015625, -0.09672962645856842,
  1.7306161136093256e-14, 1.1015625, -0.09672962645856842,
  1.7306161136093256e-14, 1.09375, -0.089612158689647, -4.012913552726574e-14,
  1.0859375, -0.08244366921110213, 2.7541708360737882e-14, 1.0859375,
  -0.08244366921110213, 2.7541708360737882e-14, 1.078125, -0.07522342123763792,
  5.0396178134370583e-14, 1.078125, -0.07522342123763792,
  5.0396178134370583e-14, 1.0703125, -0.06795066190852594,
  1.8195060030168815e-14, 1.0625, -0.06062462181648698, 5.213620639136504e-14,
  1.0625, -0.06062462181648698, 5.213620639136504e-14, 1.0546875,
  -0.053244514518837605, 2.532168943117445e-14, 1.0546875,
  -0.053244514518837605, 2.532168943117445e-14, 1.046875, -0.045809536031242715,
  -5.148849572685811e-14, 1.046875, -0.045809536031242715,
  -5.148849572685811e-14, 1.0390625, -0.038318864302141264,
  4.6652946995830086e-15, 1.0390625, -0.038318864302141264,
  4.6652946995830086e-15, 1.03125, -0.03077165866670839, -4.529814257790929e-14,
  1.03125, -0.03077165866670839, -4.529814257790929e-14, 1.0234375,
  -0.023167059281490765, -4.361324067851568e-14, 1.015625,
  -0.015504186535963527, -1.7274567499706107e-15, 1.015625,
  -0.015504186535963527, -1.7274567499706107e-15, 1.0078125,
  -0.0077821404420319595, -2.298941004620351e-14, 1.0078125,
  -0.0077821404420319595, -2.298941004620351e-14, 1, 0, 0, 1, 0, 0, 0.9921875,
  0.007843177461040796, -1.4902732911301337e-14, 0.984375, 0.01574835696817445,
  -3.527980389655325e-14, 0.9765625, 0.023716526617363343,
  -4.730054772033249e-14, 0.96875, 0.03174869831457272, 7.580310369375161e-15,
  0.9609375, 0.039845908547249564, -4.9893776716773285e-14, 0.953125,
  0.048009219186383234, -2.262629393030674e-14, 0.9453125, 0.056239718322899535,
  -2.345674491018699e-14, 0.94140625, 0.06038051098892083,
  -1.3352588834854848e-14, 0.93359375, 0.06871389254808946,
  -3.765296820388875e-14, 0.92578125, 0.07711730334438016,
  5.1128335719851986e-14, 0.91796875, 0.08559193033545398,
  -5.046674438470119e-14, 0.9140625, 0.08985632912185793,
  3.1218748807418837e-15, 0.90625, 0.09844007281321865, 3.3871241029241416e-14,
  0.8984375, 0.10709813555638448, -1.7376727386423858e-14, 0.89453125,
  0.11145544092528326, 3.957125899799804e-14, 0.88671875, 0.12022742699821265,
  -5.2849453521890294e-14, 0.8828125, 0.12464244520731427,
  -3.767012502308738e-14, 0.875, 0.13353139262449076, 3.1859736349078334e-14,
  0.87109375, 0.13800567301939282, 5.0900642926060466e-14, 0.86328125,
  0.14701474296180095, 8.710783796122478e-15, 0.859375, 0.15154989812720032,
  6.157896229122976e-16, 0.8515625, 0.16068238169043525, 3.821577743916796e-14,
  0.84765625, 0.16528009093906348, 3.9440046718453496e-14, 0.83984375,
  0.17453941635187675, 2.2924522154618074e-14, 0.8359375, 0.17920142945774842,
  -3.742530094732263e-14, 0.83203125, 0.18388527877016259,
  -2.5223102140407338e-14, 0.82421875, 0.1933193110035063,
  -1.0320443688698849e-14, 0.8203125, 0.19806991376208316,
  1.0634128304268335e-14, 0.8125, 0.20763936477828793, -4.3425422595242564e-14,
  0.80859375, 0.21245865121420593, -1.2527395755711364e-14, 0.8046875,
  0.21730127569003344, -5.204008743405884e-14, 0.80078125, 0.22216746534115828,
  -3.979844515951702e-15, 0.79296875, 0.2319714654378231,
  -4.7955860343296286e-14, 0.7890625, 0.2369097470783572, 5.015686013791602e-16,
  0.78515625, 0.24187253642048745, -7.252318953240293e-16, 0.78125,
  0.2468600779315011, 2.4688324156011588e-14, 0.7734375, 0.2569104137850218,
  5.465121253624792e-15, 0.76953125, 0.26197371574153294, 4.102651071698446e-14,
  0.765625, 0.2670627852490952, -4.996736502345936e-14, 0.76171875,
  0.27217788591576664, 4.903580708156347e-14, 0.7578125, 0.27731928541618345,
  5.089628039500759e-14, 0.75390625, 0.28248725557466514,
  1.1782016386565151e-14, 0.74609375, 0.29290401643288533,
  4.727452940514406e-14, 0.7421875, 0.29815337231912054,
  -4.4204083338755686e-14, 0.73828125, 0.3034304294199046,
  1.548345993498083e-14, 0.734375, 0.30873548164959175, 2.1522127491642888e-14,
  0.73046875, 0.3140688276249648, 1.1054030169005386e-14, 0.7265625,
  0.31943077076641657, -5.534326352070679e-14, 0.72265625, 0.3248216194012912,
  -5.351646604259541e-14, 0.71875, 0.33024168687052224, 5.4612144489920215e-14,
  0.71484375, 0.3356912916381134, 2.8136969901227338e-14, 0.7109375,
  0.3411707574027787, -1.156568624616423e-14,
];
// 2^(k/128) as the words of tail T[k] then scale H[k] - (k << 52) / 128 (e_exp_data.c)
const EXP_TABLE = [
  0x00000000, 0x00000000, 0x3ff00000, 0x00000000, 0x3c9b3b4f, 0x1a88bf6e,
  0x3feff63d, 0xa9fb3335, 0xbc716013, 0x9cd8dc5d, 0x3fefec9a, 0x3e778061,
  0xbc905e7a, 0x108766d1, 0x3fefe315, 0xe86e7f85, 0x3c8cd252, 0x3567f613,
  0x3fefd9b0, 0xd3158574, 0xbc8bce80, 0x23f98efa, 0x3fefd06b, 0x29ddf6de,
  0x3c60f74e, 0x61e6c861, 0x3fefc745, 0x18759bc8, 0x3c90a3e4, 0x5b33d399,
  0x3fefbe3e, 0xcac6f383, 0x3c979aa6, 0x5d837b6d, 0x3fefb558, 0x6cf9890f,
  0x3c8eb51a, 0x92fdeffc, 0x3fefac92, 0x2b7247f7, 0x3c3ebe3d, 0x702f9cd1,
  0x3fefa3ec, 0x32d3d1a2, 0xbc6a0334, 0x89906e0b, 0x3fef9b66, 0xaffed31b,
  0xbc955652, 0x2a2fbd0e, 0x3fef9301, 0xd0125b51, 0xbc5080ef, 0x8c4eea55,
  0x3fef8abd, 0xc06c31cc, 0xbc91c923, 0xb9d5f416, 0x3fef829a, 0xaea92de0,
  0x3c80d3e3, 0xe95c55af, 0x3fef7a98, 0xc8a58e51, 0xbc801b15, 0xeaa59348,
  0x3fef72b8, 0x3c7d517b, 0xbc8f1ff0, 0x55de323d, 0x3fef6af9, 0x388c8dea,
  0x3c8b898c, 0x3f1353bf, 0x3fef635b, 0xeb6fcb75, 0xbc96d99c, 0x7611eb26,
  0x3fef5be0, 0x84045cd4, 0x3c9aecf7, 0x3e3a2f60, 0x3fef5487, 0x3168b9aa,
  0xbc8fe782, 0xcb86389d, 0x3fef4d50, 0x22fcd91d, 0x3c8a6f41, 0x44a6c38d,
  0x3fef463b, 0x88628cd6, 0x3c807a05, 0xb0e4047d, 0x3fef3f49, 0x917ddc96,
  0x3c968efd, 0xe3a8a894, 0x3fef387a, 0x6e756238, 0x3c875e18, 0xf274487d,
  0x3fef31ce, 0x4fb2a63f, 0x3c80472b, 0x981fe7f2, 0x3fef2b45, 0x65e27cdd,
  0xbc96b87b, 0x3f71085e, 0x3fef24df, 0xe1f56381, 0x3c82f7e1, 0x6d09ab31,
  0x3fef1e9d, 0xf51fdee1, 0xbc3d219b, 0x1a6fbffa, 0x3fef187f, 0xd0dad990,
  0x3c8b3782, 0x720c0ab4, 0x3fef1285, 0xa6e4030b, 0x3c6e1492, 0x89cecb8f,
  0x3fef0caf, 0xa93e2f56, 0x3c834d75, 0x4db0abb6, 0x3fef06fe, 0x0a31b715,
  0x3c864201, 0xe2ac744c, 0x3fef0170, 0xfc4cd831, 0x3c8fdd39, 0x5dd3f84a,
  0x3feefc08, 0xb26416ff, 0xbc86a380, 0x3b8e5b04, 0x3feef6c5, 0x5f929ff1,
  0xbc924aed, 0xcc4b5068, 0x3feef1a7, 0x373aa9cb, 0xbc9907f8, 0x1b512d8e,
  0x3feeecae, 0x6d05d866, 0xbc71d1e8, 0x3e9436d2, 0x3feee7db, 0x34e59ff7,
  0xbc991919, 0xb3ce1b15, 0x3feee32d, 0xc313a8e5, 0x3c859f48, 0xa72a4c6d,
  0x3feedea6, 0x4c123422, 0xbc931260, 0x7a28698a, 0x3feeda45, 0x04ac801c,
  0xbc58a78f, 0x4817895b, 0x3feed60a, 0x21f72e2a, 0xbc7c2c9b, 0x67499a1b,
  0x3feed1f5, 0xd950a897, 0x3c4363ed, 0x60c2ac11, 0x3feece08, 0x6061892d,
  0x3c966609, 0x3b0664ef, 0x3feeca41, 0xed1d0057, 0x3c6ecce1, 0xdaa10379,
  0x3feec6a2, 0xb5c13cd0, 0x3c93ff8e, 0x3f0f1230, 0x3feec32a, 0xf0d7d3de,
  0x3c7690ce, 0xbb7aafb0, 0x3feebfda, 0xd5362a27, 0x3c931dbd, 0xeb54e077,
  0x3feebcb2, 0x99fddd0d, 0xbc8f9434, 0x0071a38e, 0x3feeb9b2, 0x769d2ca7,
  0xbc87decc, 0xdc93a349, 0x3feeb6da, 0xa2cf6642, 0xbc78dec6, 0xbd0f385f,
  0x3feeb42b, 0x569d4f82, 0xbc861246, 0xec7b5cf6, 0x3feeb1a4, 0xca5d920f,
  0x3c933505, 0x18fdd78e, 0x3feeaf47, 0x36b527da, 0x3c7b98b7, 0x2f8a9b05,
  0x3feead12, 0xd497c7fd, 0x3c9063e1, 0xe21c5409, 0x3feeab07, 0xdd485429,
  0x3c34c785, 0x5019c6ea, 0x3feea926, 0x8a5946b7, 0x3c9432e6, 0x2b64c035,
  0x3feea76f, 0x15ad2148, 0xbc8ce44a, 0x6199769f, 0x3feea5e1, 0xb976dc09,
  0xbc8c33c5, 0x3bef4da8, 0x3feea47e, 0xb03a5585, 0xbc845378, 0x892be9ae,
  0x3feea346, 0x34ccc320, 0xbc93cedd, 0x78565858, 0x3feea238, 0x82552225,
  0x3c5710aa, 0x807e1964, 0x3feea155, 0xd44ca973, 0xbc93b3ef, 0xbf5e2228,
  0x3feea09e, 0x667f3bcd, 0xbc6a12ad, 0x8734b982, 0x3feea012, 0x750bdabf,
  0xbc6367ef, 0xb86da9ee, 0x3fee9fb2, 0x3c651a2f, 0xbc80dc3d, 0x54e08851,
  0x3fee9f7d, 0xf9519484, 0xbc781f64, 0x7e5a3ecf, 0x3fee9f75, 0xe8ec5f74,
  0xbc86ee4a, 0xc08b7db0, 0x3fee9f9a, 0x48a58174, 0xbc861932, 0x1e55e68a,
  0x3fee9feb, 0x564267c9, 0x3c909ccb, 0x5e09d4d3, 0x3feea069, 0x4fde5d3f,
  0xbc7b32dc, 0xb94da51d, 0x3feea114, 0x73eb0187, 0x3c94ecfd, 0x5467c06b,
  0x3feea1ed, 0x0130c132, 0x3c65ebe1, 0xabd66c55, 0x3feea2f3, 0x36cf4e62,
  0xbc88a1c5, 0x2fb3cf42, 0x3feea427, 0x543e1a12, 0xbc9369b6, 0xf13b3734,
  0x3feea589, 0x994cce13, 0xbc805e84, 0x3a19ff1e, 0x3feea71a, 0x4623c7ad,
  0xbc94d450, 0xd872576e, 0x3feea8d9, 0x9b4492ed, 0x3c90ad67, 0x5b0e8a00,
  0x3feeaac7, 0xd98a6699, 0x3c8db72f, 0xc1f0eab4, 0x3feeace5, 0x422aa0db,
  0xbc65b660, 0x9cc5e7ff, 0x3feeaf32, 0x16b5448c, 0x3c7bf683, 0x59f35f44,
  0x3feeb1ae, 0x99157736, 0xbc93091f, 0xa71e3d83, 0x3feeb45b, 0x0b91ffc6,
  0xbc5da9b8, 0x8b6c1e29, 0x3feeb737, 0xb0cdc5e5, 0xbc6c23f9, 0x7c90b959,
  0x3feeba44, 0xcbc8520f, 0xbc924343, 0x22f4f9aa, 0x3feebd82, 0x9fde4e50,
  0xbc85ca6c, 0xd7668e4b, 0x3feec0f1, 0x70ca07ba, 0x3c71affc, 0x2b91ce27,
  0x3feec491, 0x82a3f090, 0x3c6dd235, 0xe10a73bb, 0x3feec863, 0x19e32323,
  0xbc87c504, 0x22622263, 0x3feecc66, 0x7b5de565, 0x3c8b1c86, 0xe3e231d5,
  0x3feed09b, 0xec4a2d33, 0xbc91bbd1, 0xd3bcbb15, 0x3feed503, 0xb23e255d,
  0x3c90cc31, 0x9cee31d2, 0x3feed99e, 0x1330b358, 0x3c846984, 0x6e735ab3,
  0x3feede6b, 0x5579fdbf, 0xbc82dfcd, 0x978e9db4, 0x3feee36b, 0xbfd3f37a,
  0x3c8c1a77, 0x92cb3387, 0x3feee89f, 0x995ad3ad, 0xbc907b8f, 0x4ad1d9fa,
  0x3feeee07, 0x298db666, 0xbc55c3d9, 0x56dcaeba, 0x3feef3a2, 0xb84f15fb,
  0xbc90a40e, 0x3da6f640, 0x3feef972, 0x8de5593a, 0xbc68d6f4, 0x38ad9334,
  0x3feeff76, 0xf2fb5e47, 0xbc91eee2, 0x6b588a35, 0x3fef05b0, 0x30a1064a,
  0x3c74ffd7, 0x0a5fddcd, 0x3fef0c1e, 0x904bc1d2, 0xbc91bdfb, 0xfa9298ac,
  0x3fef12c2, 0x5bd71e09, 0x3c736eae, 0x30af0cb3, 0x3fef199b, 0xdd85529c,
  0x3c8ee332, 0x5c9ffd94, 0x3fef20ab, 0x5fffd07a, 0x3c84e08f, 0xd10959ac,
  0x3fef27f1, 0x2e57d14b, 0x3c63cdaf, 0x384e1a67, 0x3fef2f6d, 0x9406e7b5,
  0x3c676b2c, 0x6c921968, 0x3fef3720, 0xdcef9069, 0xbc808a18, 0x83ccb5d2,
  0x3fef3f0b, 0x555dc3fa, 0xbc8fad5d, 0x3ffffa6f, 0x3fef472d, 0x4a07897c,
  0xbc900dae, 0x3875a949, 0x3fef4f87, 0x080d89f2, 0x3c74a385, 0xa63d07a7,
  0x3fef5818, 0xdcfba487, 0xbc82919e, 0x2040220f, 0x3fef60e3, 0x16c98398,
  0x3c8e5a50, 0xd5c192ac, 0x3fef69e6, 0x03db3285, 0x3c843a59, 0xac016b4b,
  0x3fef7321, 0xf301b460, 0xbc82d521, 0x07b43e1f, 0x3fef7c97, 0x337b9b5f,
  0xbc892ab9, 0x3b470dc9, 0x3fef8646, 0x14f5a129, 0x3c74b604, 0x603a88d3,
  0x3fef902e, 0xe78b3ff6, 0x3c83c5ec, 0x519d7271, 0x3fef9a51, 0xfbc74c83,
  0xbc8ff712, 0x8fd391f0, 0x3fefa4af, 0xa2a490da, 0xbc8dae98, 0xe223747d,
  0x3fefaf48, 0x2d8e67f1, 0x3c8ec3bc, 0x41aa2008, 0x3fefba1b, 0xee615a27,
  0x3c842b94, 0xc3a9eb32, 0x3fefc52b, 0x376bba97, 0x3c8a64a9, 0x31d185ee,
  0x3fefd076, 0x5b6e4540, 0xbc8e37ba, 0xe43be3ed, 0x3fefdbfd, 0xad9cbe14,
  0x3c77893b, 0x4d91cd9d, 0x3fefe7c1, 0x819e90d8, 0x3c5305c1, 0x4160cc89,
  0x3feff3c2, 0x2b8f71f1,
];

const LN2_HI = 0.6931471805598903;
const LN2_LO = 5.497923018708371e-14;
// Scaled log1p coefficients, A[0] = -0.5
const A0 = -0.5;
const A1 = -0.6666666666666679;
const A2 = 0.5000000000000007;
const A3 = 0.7999999995323976;
const A4 = -0.6666666663487739;
const A5 = -1.142909628459501;
const A6 = 1.0000415263675542;
const INV_LN2_N = 184.6649652337873;
const NEG_LN2_HI_N = -0.005415212348111709;
const NEG_LN2_LO_N = -1.2864023111638346e-14;
const C2 = 0.49999999999996786;
const C3 = 0.16666666666665886;
const C4 = 0.0416666808410674;
const C5 = 0.008333335853059549;
const SHIFT = 6755399441055744; // 0x1.8p52
const SIGN_BIAS = 0x800 << 7;
const TWO_1009 = 2 ** 1009;
const TWO_M1022 = 2 ** -1022;
const TWO_52 = 2 ** 52;

// Explicit endianness keeps the word order right on any host.
const view = new DataView(new ArrayBuffer(8));
function hiWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(0);
}
function loWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}
function fromWords(hi: number, lo: number): number {
  view.setUint32(0, hi >>> 0);
  view.setUint32(4, lo >>> 0);
  return view.getFloat64(0);
}

/** 2^e for a normal exponent, built from its bits rather than by calling pow. */
function powerOfTwo(e: number): number {
  return fromWords((e + 1023) << 20, 0);
}

/** m * 2^e for a finite double, with an integer significand. */
function decompose(x: number): [bigint, number] {
  const hi = hiWord(x);
  const lo = loWord(x);
  const biased = (hi >>> 20) & 0x7ff;
  let significand = (BigInt(hi & 0xfffff) << BigInt(32)) | BigInt(lo);
  let exponent = -1074;
  if (biased !== 0) {
    significand |= BigInt(1) << BigInt(52);
    exponent = biased - 1075;
  }
  return [hi >>> 31 ? -significand : significand, exponent];
}

/** Rounds m * 2^e to the nearest double, ties to even. Normal results only. */
function roundToDouble(significand: bigint, exponent: number): number {
  if (significand === BigInt(0)) {
    return 0;
  }
  const negative = significand < BigInt(0);
  let m = negative ? -significand : significand;
  const excess = m.toString(2).length - 53;
  if (excess > 0) {
    const shift = BigInt(excess);
    const kept = m >> shift;
    const rest = m - (kept << shift);
    const half = BigInt(1) << (shift - BigInt(1));
    m =
      rest > half || (rest === half && (kept & BigInt(1)) === BigInt(1))
        ? kept + BigInt(1)
        : kept;
    exponent += excess;
  }
  // Two steps, so neither power of two over- or underflows on its own
  const halfExponent = Math.trunc(exponent / 2);
  const value =
    Number(m) * powerOfTwo(halfExponent) * powerOfTwo(exponent - halfExponent);
  return negative ? -value : value;
}

function exactFma(a: number, b: number, c: number): number {
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const product = ma * mb;
  if (product === BigInt(0)) {
    return a * b + c;
  }
  const productExponent = ea + eb;
  const exponent = Math.min(productExponent, ec);
  const sum =
    (product << BigInt(productExponent - exponent)) +
    (mc << BigInt(ec - exponent));
  return sum === BigInt(0) ? 0 : roundToDouble(sum, exponent);
}

const SPLITTER = 134217729; // 2^27 + 1
const SMALLEST_SAFE = 2 ** -900;
const LARGEST_SAFE = 2 ** 995;

/**
 * a * b + c with a single rounding, as the FMA instruction computes it. Error-free product and
 * sum transformations settle all but the rare near-tie cases, which fall back to exact BigInt
 * arithmetic.
 */
export function fma(a: number, b: number, c: number): number {
  const p = a * b;
  const absP = Math.abs(p);
  if (
    !Number.isFinite(p) ||
    !Number.isFinite(c) ||
    absP < SMALLEST_SAFE ||
    Math.abs(a) > LARGEST_SAFE ||
    Math.abs(b) > LARGEST_SAFE ||
    (c !== 0 && Math.abs(c) < SMALLEST_SAFE)
  ) {
    return Number.isFinite(p) && Number.isFinite(c) && p !== 0
      ? exactFma(a, b, c)
      : a * b + c;
  }
  // Dekker: p + e == a * b exactly
  let t = SPLITTER * a;
  const aHi = t - (t - a);
  const aLo = a - aHi;
  t = SPLITTER * b;
  const bHi = t - (t - b);
  const bLo = b - bHi;
  const e = aHi * bHi - p + aHi * bLo + aLo * bHi + aLo * bLo;
  // Knuth: s + sErr == p + c exactly
  const s = p + c;
  let bb = s - p;
  const sErr = p - (s - bb) + (c - bb);
  // u + v == sErr + e exactly
  const u = sErr + e;
  bb = u - sErr;
  const v = sErr - (u - bb) + (e - bb);
  const r = s + u;
  if (v === 0) {
    // a * b + c == s + u exactly, rounded once
    return r;
  }
  // r + w == s + u exactly, so a * b + c == r + w + v
  bb = r - s;
  const w = s - (r - bb) + (u - bb);
  const rHi = hiWord(r);
  // A power of two has a narrower rounding interval below it: leave those to the exact path
  if (((rHi & 0xfffff) | loWord(r)) !== 0) {
    const biased = (rHi >>> 20) & 0x7ff;
    // Safely inside the rounding interval: v can't have moved the result
    if (
      biased > 54 &&
      Math.abs(w) + Math.abs(v) < fromWords((biased - 53) << 20, 0)
    ) {
      return r;
    }
  }
  return exactFma(a, b, c);
}

/** log(x) as hi + lo, for the bit pattern of a positive normal x. */
function logInline(ixHi: number, ixLo: number, out: Float64Array): void {
  // tmp = ix - OFF, OFF = 0x3fe6955500000000; its low word is zero, so there is no borrow
  const tmpHi = (ixHi - 0x3fe69555) | 0;
  const i = (tmpHi >>> 13) & 127;
  const k = tmpHi >> 20;
  const z = fromWords((ixHi - (tmpHi & 0xfff00000)) | 0, ixLo);
  const row = 3 * i;
  const invc = POW_LOG_TABLE[row];
  const logc = POW_LOG_TABLE[row + 1];
  const logctail = POW_LOG_TABLE[row + 2];

  const r = fma(z, invc, -1.0);
  const t1 = fma(k, LN2_HI, logc);
  const t2 = t1 + r;
  const lo1 = fma(k, LN2_LO, logctail);
  const lo2 = t1 - t2 + r;
  const ar = A0 * r;
  const ar2 = r * ar;
  const ar3 = r * ar2;
  const hi = t2 + ar2;
  const lo3 = fma(ar, r, -ar2);
  const lo4 = t2 - hi + ar2;
  const q = fma(ar2, fma(ar2, fma(r, A6, A5), fma(r, A4, A3)), fma(r, A2, A1));
  const lo = fma(ar3, q, lo1 + lo2 + lo3 + lo4);
  const y = hi + lo;
  out[0] = y;
  out[1] = hi - y + lo;
}

function specialCase(
  tmp: number,
  sbitsHi: number,
  sbitsLo: number,
  kiLo: number,
): number {
  if ((kiLo & 0x80000000) === 0) {
    // k > 0: the exponent of scale might have overflowed by <= 460
    const scale = fromWords((sbitsHi - (1009 << 20)) | 0, sbitsLo);
    return TWO_1009 * fma(scale, tmp, scale);
  }
  // k < 0: take care in the subnormal range
  const hiBits = (sbitsHi + (1022 << 20)) | 0;
  const scale = fromWords(hiBits, sbitsLo);
  let y = fma(scale, tmp, scale);
  if (Math.abs(y) < 1.0) {
    const one = y < 0.0 ? -1.0 : 1.0;
    let lo = fma(scale, tmp, scale - y);
    const hi = one + y;
    lo = one - hi + y + lo;
    y = hi + lo - one;
    if (y === 0) {
      y = hiBits >>> 31 ? -0 : 0;
    }
  }
  return TWO_M1022 * y;
}

/** sign * exp(x + xtail), sign set by signBias. */
function expInline(x: number, xtail: number, signBias: number): number {
  let abstop = (hiWord(x) >>> 20) & 0x7ff;
  if ((abstop - 0x3c9) >>> 0 >= 0x408 - 0x3c9) {
    if ((abstop - 0x3c9) >>> 0 >= 0x80000000) {
      // Tiny x
      const one = 1.0 + x;
      return signBias ? -one : one;
    }
    if (abstop >= 0x409) {
      if (x < 0) {
        return signBias ? -0 : 0;
      }
      return signBias ? -Infinity : Infinity;
    }
    // Large x is special cased below
    abstop = 0;
  }
  let kd = fma(INV_LN2_N, x, SHIFT);
  const kiLo = loWord(kd);
  kd -= SHIFT;
  let r = fma(kd, NEG_LN2_LO_N, fma(kd, NEG_LN2_HI_N, x));
  r += xtail;
  const idx = 4 * (kiLo & 127);
  const tail = fromWords(EXP_TABLE[idx], EXP_TABLE[idx + 1]);
  const sbitsHi = (EXP_TABLE[idx + 2] + (((kiLo + signBias) << 13) | 0)) | 0;
  const sbitsLo = EXP_TABLE[idx + 3];
  const r2 = r * r;
  const tmp = fma(r2 * r2, fma(r, C5, C4), fma(r2, fma(r, C3, C2), tail + r));
  if (abstop === 0) {
    return specialCase(tmp, sbitsHi, sbitsLo, kiLo);
  }
  const scale = fromWords(sbitsHi, sbitsLo);
  return fma(scale, tmp, scale);
}

/** 0 if not an integer, 1 if odd, 2 if even, for a non-zero finite y. */
function checkInt(hi: number, lo: number): number {
  const e = (hi >>> 20) & 0x7ff;
  if (e < 0x3ff) {
    return 0;
  }
  if (e > 0x3ff + 52) {
    return 2;
  }
  const shift = 0x3ff + 52 - e; // bits below the units place
  let fractionBits: number;
  let unitBit: number;
  if (shift >= 32) {
    fractionBits = lo | (hi & ((1 << (shift - 32)) - 1));
    unitBit = (hi >>> (shift - 32)) & 1;
  } else {
    fractionBits = shift === 0 ? 0 : lo & ((1 << shift) - 1);
    unitBit = (lo >>> shift) & 1;
  }
  if (fractionBits !== 0) {
    return 0;
  }
  return unitBit ? 1 : 2;
}

/** Whether the bits are those of +-0, +-Infinity or NaN. */
function zeroInfNan(hi: number, lo: number): boolean {
  const absHi = hi & 0x7fffffff;
  return (absHi | lo) === 0 || absHi >= 0x7ff00000;
}

const logParts = new Float64Array(2);

/** glibc's pow for the cases V8 hands to std::pow. */
function glibcPow(x: number, y: number): number {
  let ixHi = hiWord(x);
  let ixLo = loWord(x);
  const iyHi = hiWord(y);
  const iyLo = loWord(y);
  let topx = ixHi >>> 20;
  const topy = iyHi >>> 20;
  let signBias = 0;
  const ixIsOne = ixHi === 0x3ff00000 && ixLo === 0;
  if (
    (topx - 0x001) >>> 0 >= 0x7ff - 0x001 ||
    ((topy & 0x7ff) - 0x3be) >>> 0 >= 0x43e - 0x3be
  ) {
    if (zeroInfNan(iyHi, iyLo)) {
      if (((iyHi & 0x7fffffff) | iyLo) === 0) {
        return 1.0;
      }
      if (ixIsOne) {
        return 1.0;
      }
      if (Number.isNaN(x) || Number.isNaN(y)) {
        return x + y;
      }
      const absX = Math.abs(x);
      if (absX === 1) {
        return 1.0;
      }
      const xBelowOne = absX < 1;
      if (xBelowOne === !(iyHi >>> 31)) {
        return 0.0;
      }
      return y * y;
    }
    if (zeroInfNan(ixHi, ixLo)) {
      let x2 = x * x;
      if (ixHi >>> 31 && checkInt(iyHi, iyLo) === 1) {
        x2 = -x2;
      }
      return iyHi >>> 31 ? 1 / x2 : x2;
    }
    // Here x and y are non-zero finite
    if (ixHi >>> 31) {
      const yint = checkInt(iyHi, iyLo);
      if (yint === 0) {
        return NaN;
      }
      if (yint === 1) {
        signBias = SIGN_BIAS;
      }
      ixHi &= 0x7fffffff;
      topx &= 0x7ff;
    }
    if (((topy & 0x7ff) - 0x3be) >>> 0 >= 0x43e - 0x3be) {
      const absIsOne = ixHi === 0x3ff00000 && ixLo === 0;
      if (absIsOne) {
        return 1.0;
      }
      const above = ixHi > 0x3ff00000 || (ixHi === 0x3ff00000 && ixLo !== 0);
      if ((topy & 0x7ff) < 0x3be) {
        // |y| < 2^-65: x^y ~= 1 + y*log(x)
        return above ? 1.0 + y : 1.0 - y;
      }
      const yPositive = topy < 0x800;
      return above === yPositive ? Infinity : 0;
    }
    if (topx === 0) {
      // Normalize a subnormal x so its exponent becomes negative
      const normalized = Math.abs(x) * TWO_52;
      ixHi = ((hiWord(normalized) & 0x7fffffff) - (52 << 20)) | 0;
      ixLo = loWord(normalized);
    }
  }
  logInline(ixHi, ixLo, logParts);
  const hi = logParts[0];
  const lo = logParts[1];
  const ehi = y * hi;
  const elo = fma(y, lo, fma(y, hi, -ehi));
  return expInline(ehi, elo, signBias);
}

/**
 * `Math.pow`, but the same on every machine: V8's own special cases, then glibc's pow.
 */
export function pow(x: number, y: number): number {
  if (Number.isNaN(y)) {
    return NaN;
  }
  if ((y === Infinity || y === -Infinity) && (x === 1 || x === -1)) {
    return NaN;
  }
  // Optimizing compilers skip pow for these two, and V8's pow matches them
  if (y === 2) {
    return x * x;
  }
  if (y === 0.5) {
    return x === -Infinity ? Infinity : Math.sqrt(x + 0);
  }
  return glibcPow(x, y);
}
