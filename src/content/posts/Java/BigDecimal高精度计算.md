---
title: BigDecimal高精度计算
published: 2025-07-26
description: ''
image: ''
tags: ['Java', '面试','高精度计算','BigDecimal']
category: 'Java > 面试题'
series: Java 基础
draft: false 
lang: ''
---
https://javaguide.cn/java/basis/bigdecimal.html

# BigDecimal详解
Java中，浮点数的运算有精度丢失的风险

为什么浮点数运算的时候会有精度丢失的风险？
  计算机是二进制的，浮点数在计算机中是通过二进制的方式来表示的。但是，浮点数的表示方式是有限的，所以在进行浮点数运算的时候，会存在精度丢失的风险。

  例如，在Java中，浮点数的表示方式是 IEEE 754 标准，使用 64 位二进制来表示一个浮点数。其中，1 位用于表示符号位，11 位用于表示指数位，52 位用于表示尾数位。但是，浮点数的表示方式是有限的，所以在进行浮点数运算的时候，会存在精度丢失的风险。

# BigDecimal 类的常用方法
BigDecimal可以实现对小数的运算，不会造成精度损失

通常情况下，大部分需要小数精确运算结果的业务场景都是通过BigDecimal来做的。

《阿里巴巴 Java 开发手册》中提到：浮点数之间的等值判断，基本数据类型不能用 == 来比较，包装数据类型不能用 equals 来判断。

## 创建
我们在使用BigDecimal的时候，需要注意以下几点：

1. 不能使用new BigDecimal(double)的方式来创建BigDecimal对象，因为double类型的精度是有限的，所以在创建BigDecimal对象的时候，会存在精度丢失的风险。

2. 可以使用new BigDecimal(String)的方式来创建BigDecimal对象，因为String类型的精度是无限的，所以在创建BigDecimal对象的时候，不会存在精度丢失的风险。

3. 可以使用BigDecimal的valueOf()方法来创建BigDecimal对象，因为valueOf()方法的参数是double类型，但是在内部会将double类型的参数转换为String类型，所以在创建BigDecimal对象的时候，不会存在精度丢失的风险。

![](https://blog.meowrain.cn/api/i/2025/07/26/zjj9sd-1.webp)

## 加减乘除
add
subtract
multiply
divide

divide可以指定保留的小数位数，以及四舍五入的方式。
```java
public BigDecimal divide(BigDecimal divisor, int scale, RoundingMode roundingMode) {
    return divide(divisor, scale, roundingMode.oldMode);
}
```

我们使用 divide 方法的时候尽量使用 3 个参数版本，并且RoundingMode 不要选择 UNNECESSARY，否则很可能会遇到 ArithmeticException（无法除尽出现无限循环小数的时候），其中 scale 表示要保留几位小数，roundingMode 代表保留规则。

scale是保留几位小数，roundingMode是保留规则。

roundingMode:
- UP 向上四舍五入
- DOWN 向下截取
- CEILING 向上截取
- FLOOR 向下截取
- HALF_UP 四舍五入
- HALF_DOWN 五舍六入
- HALF_EVEN 四舍六入五取偶

# RoundingMode枚举详解 📚📊

## 各种舍入模式详细说明

### 1. UP - 向上舍入 ⬆️
```java
// 绝对值增大方向舍入，远离零的方向
2.4 -> 3    // 正数向上
1.6 -> 2    // 正数向上
-1.6 -> -2  // 负数向更小（绝对值更大）
-2.4 -> -3  // 负数向更小
```

### 2. DOWN - 向下舍入 ⬇️
```java
// 绝对值减小方向舍入，趋向零的方向
2.4 -> 2    // 正数向下
1.6 -> 1    // 正数向下
-1.6 -> -1  // 负数向更大（绝对值更小）
-2.4 -> -2  // 负数向更大
```

### 3. CEILING - 向正无穷舍入 ☁️
```java
// 向数轴右侧舍入
2.4 -> 3    // 正数向上
1.6 -> 2    // 正数向上
-1.6 -> -1  // 负数向更大（向右）
-2.4 -> -2  // 负数向更大
```

### 4. FLOOR - 向负无穷舍入 ⚡
```java
// 向数轴左侧舍入
2.4 -> 2    // 正数向下
1.6 -> 1    // 正数向下
-1.6 -> -2  // 负数向更小（向左）
-2.4 -> -3  // 负数向更小
```

### 5. HALF_UP - 四舍五入 🎯
```java
// 遇5向上舍入
2.4 -> 2    // 小于5，向下
2.5 -> 3    // 等于5，向上
2.6 -> 3    // 大于5，向上
-1.5 -> -2  // 负数也一样，-1.5 -> -2
-1.4 -> -1  // -1.4 -> -1
```

## 实际代码示例 💡

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class RoundingModeDemo {
    public static void main(String[] args) {
        BigDecimal[] testNumbers = {
            new BigDecimal("2.4"),
            new BigDecimal("2.5"),
            new BigDecimal("2.6"),
            new BigDecimal("-1.4"),
            new BigDecimal("-1.5"),
            new BigDecimal("-1.6")
        };
      
        for (BigDecimal num : testNumbers) {
            System.out.println("\n原数: " + num);
            System.out.println("UP: " + num.setScale(0, RoundingMode.UP));
            System.out.println("DOWN: " + num.setScale(0, RoundingMode.DOWN));
            System.out.println("CEILING: " + num.setScale(0, RoundingMode.CEILING));
            System.out.println("FLOOR: " + num.setScale(0, RoundingMode.FLOOR));
            System.out.println("HALF_UP: " + num.setScale(0, RoundingMode.HALF_UP));
        }
    }
}
```

## 输出结果展示 📊

```
原数: 2.4
UP: 3
DOWN: 2
CEILING: 3
FLOOR: 2
HALF_UP: 2

原数: 2.5
UP: 3
DOWN: 2
CEILING: 3
FLOOR: 2
HALF_UP: 3

原数: -1.5
UP: -2
DOWN: -1
CEILING: -1
FLOOR: -2
HALF_UP: -2
```

## 使用场景建议 🎯

```java
public class RoundingMode应用场景 {
    public static void main(String[] args) {
        // 金融计算 - 通常使用HALF_UP（银行家舍入）
        BigDecimal money = new BigDecimal("123.455");
        BigDecimal roundedMoney = money.setScale(2, RoundingMode.HALF_UP);
      
        // 统计计算 - 可能使用HALF_EVEN（银行家舍入）
        BigDecimal average = new BigDecimal("87.345");
        BigDecimal roundedAvg = average.setScale(2, RoundingMode.HALF_EVEN);
      
        // 科学计算 - 根据需要选择合适的模式
        BigDecimal scientific = new BigDecimal("99.999");
        BigDecimal ceilingResult = scientific.setScale(2, RoundingMode.CEILING);
    }
}
```



# BigDecimal等值比较
使用compareTo进行比较，因为equals会比较值和精度，但是compareTo会忽略精度

compareTo() 方法可以比较两个 BigDecimal 的值，如果相等就返回 0，如果第 1 个数比第 2 个数大则返回 1，反之返回-1。

# BigDecimal工具类
```java
import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 简化BigDecimal计算的小工具类
 */
public class BigDecimalUtil {

    /**
     * 默认除法运算精度
     */
    private static final int DEF_DIV_SCALE = 10;

    private BigDecimalUtil() {
    }

    /**
     * 提供精确的加法运算。
     *
     * @param v1 被加数
     * @param v2 加数
     * @return 两个参数的和
     */
    public static double add(double v1, double v2) {
        BigDecimal b1 = BigDecimal.valueOf(v1);
        BigDecimal b2 = BigDecimal.valueOf(v2);
        return b1.add(b2).doubleValue();
    }

    /**
     * 提供精确的减法运算。
     *
     * @param v1 被减数
     * @param v2 减数
     * @return 两个参数的差
     */
    public static double subtract(double v1, double v2) {
        BigDecimal b1 = BigDecimal.valueOf(v1);
        BigDecimal b2 = BigDecimal.valueOf(v2);
        return b1.subtract(b2).doubleValue();
    }

    /**
     * 提供精确的乘法运算。
     *
     * @param v1 被乘数
     * @param v2 乘数
     * @return 两个参数的积
     */
    public static double multiply(double v1, double v2) {
        BigDecimal b1 = BigDecimal.valueOf(v1);
        BigDecimal b2 = BigDecimal.valueOf(v2);
        return b1.multiply(b2).doubleValue();
    }

    /**
     * 提供（相对）精确的除法运算，当发生除不尽的情况时，精确到
     * 小数点以后10位，以后的数字四舍六入五成双。
     *
     * @param v1 被除数
     * @param v2 除数
     * @return 两个参数的商
     */
    public static double divide(double v1, double v2) {
        return divide(v1, v2, DEF_DIV_SCALE);
    }

    /**
     * 提供（相对）精确的除法运算。当发生除不尽的情况时，由scale参数指
     * 定精度，以后的数字四舍六入五成双。
     *
     * @param v1    被除数
     * @param v2    除数
     * @param scale 表示表示需要精确到小数点以后几位。
     * @return 两个参数的商
     */
    public static double divide(double v1, double v2, int scale) {
        if (scale < 0) {
            throw new IllegalArgumentException(
                    "The scale must be a positive integer or zero");
        }
        BigDecimal b1 = BigDecimal.valueOf(v1);
        BigDecimal b2 = BigDecimal.valueOf(v2);
        return b1.divide(b2, scale, RoundingMode.HALF_EVEN).doubleValue();
    }

    /**
     * 提供精确的小数位四舍六入五成双处理。
     *
     * @param v     需要四舍六入五成双的数字
     * @param scale 小数点后保留几位
     * @return 四舍六入五成双后的结果
     */
    public static double round(double v, int scale) {
        if (scale < 0) {
            throw new IllegalArgumentException(
                    "The scale must be a positive integer or zero");
        }
        BigDecimal b = BigDecimal.valueOf(v);
        BigDecimal one = new BigDecimal("1");
        return b.divide(one, scale, RoundingMode.HALF_UP).doubleValue();
    }

    /**
     * 提供精确的类型转换(Float)
     *
     * @param v 需要被转换的数字
     * @return 返回转换结果
     */
    public static float convertToFloat(double v) {
        BigDecimal b = new BigDecimal(v);
        return b.floatValue();
    }

    /**
     * 提供精确的类型转换(Int)不进行四舍六入五成双
     *
     * @param v 需要被转换的数字
     * @return 返回转换结果
     */
    public static int convertsToInt(double v) {
        BigDecimal b = new BigDecimal(v);
        return b.intValue();
    }

    /**
     * 提供精确的类型转换(Long)
     *
     * @param v 需要被转换的数字
     * @return 返回转换结果
     */
    public static long convertsToLong(double v) {
        BigDecimal b = new BigDecimal(v);
        return b.longValue();
    }

    /**
     * 返回两个数中大的一个值
     *
     * @param v1 需要被对比的第一个数
     * @param v2 需要被对比的第二个数
     * @return 返回两个数中大的一个值
     */
    public static double returnMax(double v1, double v2) {
        BigDecimal b1 = new BigDecimal(v1);
        BigDecimal b2 = new BigDecimal(v2);
        return b1.max(b2).doubleValue();
    }

    /**
     * 返回两个数中小的一个值
     *
     * @param v1 需要被对比的第一个数
     * @param v2 需要被对比的第二个数
     * @return 返回两个数中小的一个值
     */
    public static double returnMin(double v1, double v2) {
        BigDecimal b1 = new BigDecimal(v1);
        BigDecimal b2 = new BigDecimal(v2);
        return b1.min(b2).doubleValue();
    }

    /**
     * 精确对比两个数字
     *
     * @param v1 需要被对比的第一个数
     * @param v2 需要被对比的第二个数
     * @return 如果两个数一样则返回0，如果第一个数比第二个数大则返回1，反之返回-1
     */
    public static int compareTo(double v1, double v2) {
        BigDecimal b1 = BigDecimal.valueOf(v1);
        BigDecimal b2 = BigDecimal.valueOf(v2);
        return b1.compareTo(b2);
    }

}
```
