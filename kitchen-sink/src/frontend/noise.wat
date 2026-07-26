;; Domain-warped ridged multifractal. noise.wasm ships beside this file and
;; is what the page actually loads; this is the readable source it was built
;; from. To change the maths, edit here and rebuild:
;;
;;   npx -p wabt wat2wasm src/frontend/noise.wat -o src/frontend/noise.wasm
;;
;; The JS reference in app.js (jsWarped/jsFill) implements the same maths, so
;; the two can be compared on output as well as on time.
(module
  ;; 8 pages = 512 KB, enough for a 512x512 grayscale field
  (memory (export "mem") 8)

  ;; integer hash -> f32 in [0,1)
  (func $hash (param $x i32) (param $y i32) (result f32)
    (local $n i32)
    (local.set $n
      (i32.add (i32.mul (local.get $x) (i32.const 374761393))
               (i32.mul (local.get $y) (i32.const 668265263))))
    (local.set $n
      (i32.mul (i32.xor (local.get $n) (i32.shr_u (local.get $n) (i32.const 13)))
               (i32.const 1274126177)))
    (local.set $n
      (i32.xor (local.get $n) (i32.shr_u (local.get $n) (i32.const 16))))
    (f32.mul
      (f32.convert_i32_u (i32.and (local.get $n) (i32.const 0x7fffffff)))
      (f32.const 4.656612873e-10)))          ;; 1 / 2147483647

  ;; smooth-interpolated value noise at (x, y)
  (func $noise2 (param $x f32) (param $y f32) (result f32)
    (local $xi i32) (local $yi i32)
    (local $xf f32) (local $yf f32) (local $u f32) (local $v f32)
    (local $a f32) (local $b f32) (local $c f32) (local $d f32)
    (local $ab f32) (local $cd f32)
    (local.set $xi (i32.trunc_f32_s (f32.floor (local.get $x))))
    (local.set $yi (i32.trunc_f32_s (f32.floor (local.get $y))))
    (local.set $xf (f32.sub (local.get $x) (f32.floor (local.get $x))))
    (local.set $yf (f32.sub (local.get $y) (f32.floor (local.get $y))))
    ;; smoothstep weights: t*t*(3-2t)
    (local.set $u
      (f32.mul (f32.mul (local.get $xf) (local.get $xf))
               (f32.sub (f32.const 3) (f32.mul (f32.const 2) (local.get $xf)))))
    (local.set $v
      (f32.mul (f32.mul (local.get $yf) (local.get $yf))
               (f32.sub (f32.const 3) (f32.mul (f32.const 2) (local.get $yf)))))
    (local.set $a (call $hash (local.get $xi) (local.get $yi)))
    (local.set $b (call $hash (i32.add (local.get $xi) (i32.const 1)) (local.get $yi)))
    (local.set $c (call $hash (local.get $xi) (i32.add (local.get $yi) (i32.const 1))))
    (local.set $d (call $hash (i32.add (local.get $xi) (i32.const 1))
                              (i32.add (local.get $yi) (i32.const 1))))
    ;; lerp(a,b,u) and lerp(c,d,u), then lerp between them by v
    (local.set $ab
      (f32.add (local.get $a)
               (f32.mul (f32.sub (local.get $b) (local.get $a)) (local.get $u))))
    (local.set $cd
      (f32.add (local.get $c)
               (f32.mul (f32.sub (local.get $d) (local.get $c)) (local.get $u))))
    (f32.add (local.get $ab)
             (f32.mul (f32.sub (local.get $cd) (local.get $ab)) (local.get $v))))

  ;; sum of `oct` octaves, each half the amplitude and twice the frequency
  (func $fbm (param $x f32) (param $y f32) (param $oct i32) (result f32)
    (local $i i32) (local $amp f32) (local $freq f32)
    (local $sum f32) (local $norm f32)
    (local.set $amp (f32.const 1))
    (local.set $freq (f32.const 1))
    (block $done
      (loop $next
        (br_if $done (i32.ge_s (local.get $i) (local.get $oct)))
        (local.set $sum
          (f32.add (local.get $sum)
                   (f32.mul (local.get $amp)
                            (call $noise2 (f32.mul (local.get $x) (local.get $freq))
                                          (f32.mul (local.get $y) (local.get $freq))))))
        (local.set $norm (f32.add (local.get $norm) (local.get $amp)))
        (local.set $amp (f32.mul (local.get $amp) (f32.const 0.5)))
        (local.set $freq (f32.mul (local.get $freq) (f32.const 2)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (f32.div (local.get $sum) (local.get $norm)))

  ;; ridged multifractal: 1 - |2v-1|, squared, with each octave's gain
  ;; weighted by the previous one — the fold is what makes the sharp creases
  (func $ridged (param $x f32) (param $y f32) (param $oct i32) (result f32)
    (local $i i32) (local $amp f32) (local $freq f32)
    (local $sum f32) (local $norm f32) (local $prev f32) (local $n f32)
    (local.set $amp (f32.const 1))
    (local.set $freq (f32.const 1))
    (local.set $prev (f32.const 1))
    (block $done
      (loop $next
        (br_if $done (i32.ge_s (local.get $i) (local.get $oct)))
        (local.set $n (call $noise2 (f32.mul (local.get $x) (local.get $freq))
                                    (f32.mul (local.get $y) (local.get $freq))))
        ;; fold: 1 - |2n - 1|
        (local.set $n (f32.sub (f32.const 1)
          (f32.abs (f32.sub (f32.mul (f32.const 2) (local.get $n)) (f32.const 1)))))
        (local.set $n (f32.mul (local.get $n) (local.get $n)))
        (local.set $n (f32.mul (local.get $n) (local.get $prev)))
        (local.set $prev (local.get $n))
        (local.set $sum (f32.add (local.get $sum) (f32.mul (local.get $amp) (local.get $n))))
        (local.set $norm (f32.add (local.get $norm) (local.get $amp)))
        (local.set $amp (f32.mul (local.get $amp) (f32.const 0.5)))
        (local.set $freq (f32.mul (local.get $freq) (f32.const 2.02)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (f32.div (local.get $sum) (local.get $norm)))

  ;; Domain warping (the Quilez recipe): push the sample point around by two
  ;; successive fbm-valued offsets before the ridged lookup. Five fbm
  ;; evaluations per pixel instead of one — the point being that this is real
  ;; per-pixel work, not a toy loop a JIT can flatten.
  (func $warped (param $x f32) (param $y f32) (param $oct i32) (result f32)
    (local $qx f32) (local $qy f32) (local $rx f32) (local $ry f32)
    (local.set $qx (call $fbm (local.get $x) (local.get $y) (local.get $oct)))
    (local.set $qy (call $fbm (f32.add (local.get $x) (f32.const 5.2))
                              (f32.add (local.get $y) (f32.const 1.3))
                              (local.get $oct)))
    (local.set $rx (call $fbm
      (f32.add (local.get $x) (f32.add (f32.mul (f32.const 4) (local.get $qx)) (f32.const 1.7)))
      (f32.add (local.get $y) (f32.add (f32.mul (f32.const 4) (local.get $qy)) (f32.const 9.2)))
      (local.get $oct)))
    (local.set $ry (call $fbm
      (f32.add (local.get $x) (f32.add (f32.mul (f32.const 4) (local.get $qx)) (f32.const 8.3)))
      (f32.add (local.get $y) (f32.add (f32.mul (f32.const 4) (local.get $qy)) (f32.const 2.8)))
      (local.get $oct)))
    (call $ridged
      (f32.add (local.get $x) (f32.mul (f32.const 4) (local.get $rx)))
      (f32.add (local.get $y) (f32.mul (f32.const 4) (local.get $ry)))
      (local.get $oct)))

  ;; Fill w*h bytes at memory[0] with the field, scrolled by t.
  ;; One byte per pixel; the page expands it to RGBA.
  (func (export "fill") (param $t f32) (param $w i32) (param $h i32) (param $oct i32)
    (local $x i32) (local $y i32) (local $p i32) (local $val f32)
    (block $rows
      (loop $row
        (br_if $rows (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $x (i32.const 0))
        (block $cols
          (loop $col
            (br_if $cols (i32.ge_s (local.get $x) (local.get $w)))
            (local.set $val
              (call $warped
                (f32.add (f32.mul (f32.convert_i32_s (local.get $x)) (f32.const 0.018))
                         (local.get $t))
                (f32.add (f32.mul (f32.convert_i32_s (local.get $y)) (f32.const 0.018))
                         (f32.mul (local.get $t) (f32.const 0.5)))
                (local.get $oct)))
            (i32.store8 (local.get $p)
              (i32.trunc_f32_s (f32.mul (local.get $val) (f32.const 255))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $x (i32.add (local.get $x) (i32.const 1)))
            (br $col)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $row))))
)
