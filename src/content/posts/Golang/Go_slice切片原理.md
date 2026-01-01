---
title: Go_slice切片原理
published: 2025-07-19
description: ''
image: 'https://blog.meowrain.cn/api/i/2025/07/19/uje4vo-1.webp'
tags: [切片, Golang, Go]
category: 'Go'
draft: false 
lang: ''
---
# slice数据结构

数据结构
我们每定义一个slice变量，golang底层都会构建一个slice结构的对象。slice结构体由3个成员变量构成：

array表示数组指针，数组用于存储数据。
len表示切片长度，也就是数组index从0到len-1已存储数据。
cap表示切片容量，当切片长度超过最大容量时，需要扩容申请更大长度的数组。

```go
type slice struct {
    array unsafe.Pointer // 数组指针
    len   int // 切片长度
    cap   int // 切片容量
}
```

# 扩容原理

切片的扩容流程源码位于 runtime/slice.go 文件的 growslice 方法当中，其中核心步骤如下：

• 倘若扩容后预期的新容量小于原切片的容量，则 panic

• 倘若切片元素大小为 0（元素类型为 struct{}），则直接复用一个全局的 zerobase 实例，直接返回

• 倘若预期的新容量超过老容量的两倍，则直接采用预期的新容量

• 倘若老容量小于 256，则直接采用老容量的2倍作为新容量

• 倘若老容量已经大于等于 256，则在老容量的基础上扩容 1/4 的比例并且累加上 192 的数值，持续这样处理，直到得到的新容量已经大于等于预期的新容量为止

• 结合 mallocgc 流程中，对内存分配单元 mspan 的等级制度，推算得到实际需要申请的内存空间大小

• 调用 mallocgc，对新切片进行内存初始化

• 调用 memmove 方法，将老切片中的内容拷贝到新切片中

• 返回扩容后的新切片

```go
// nextslicecap computes the next appropriate slice length.
func nextslicecap(newLen, oldCap int) int {
 newcap := oldCap // 将新容量初始化为旧容量
 doublecap := newcap + newcap // 计算旧容量的两倍

 // 如果所需的新长度大于旧容量的两倍，则直接使用所需的新长度
 if newLen > doublecap {
  return newLen
 }

 const threshold = 256 // 定义一个阈值，用于区分小切片和大切片

 // 如果旧容量小于阈值，则直接将新容量设置为旧容量的两倍
 // 这种策略适用于小切片，可以快速扩容，减少扩容次数
 if oldCap < threshold {
  return doublecap
 }

 // 对于大切片，使用更平滑的扩容策略，避免过度分配内存
 // 从 2 倍增长过渡到 1.25 倍增长。 此公式给出了两者之间的平滑过渡。
 for {
  // 每次循环，将新容量增加 (newcap + 3*threshold) / 4
  // 相当于 newcap 增加 1/4 的比例，再加上 3/4 的 threshold(256)，即 192
  // 这样可以在一定程度上减少内存浪费，并保证切片的增长
  newcap += (newcap + 3*threshold) >> 2

  // Check for overflow and determine if the new calculated capacity
  // is greater or equal to the required new length.
  // newLen is guaranteed to be larger than zero, hence
  // when newcap overflows then `uint(newcap) > uint(newLen)`.
  // This allows to check for both with the same comparison.

  // 我们需要检查`newcap >= newLen`以及`newcap`是否溢出。
  // 保证 newLen 大于零，因此当 newcap 溢出时，'uint(newcap) > uint(newLen)'。
  // 这允许使用相同的比较来检查两者。

  // 检查新容量是否大于等于所需的新长度，并且检查是否发生了溢出
  if uint(newcap) >= uint(newLen) {
   break // 如果新容量足够大，或者发生了溢出，则退出循环
  }
 }

 // 当新容量计算溢出时，将新容量设置为请求的容量。
 // 如果计算过程中发生了溢出，则直接将新容量设置为所需的新长度，以确保切片能够容纳所有元素
 if newcap <= 0 {
  return newLen
 }

 return newcap // 返回计算得到的新容量
}
```

# Golang 切片原理

![](https://blog.meowrain.cn/api/i/2025/01/27/STHBnZ1737969258402080877.avif)

![](https://blog.meowrain.cn/api/i/2025/01/27/L5OPBU1737969429035465587.avif)

## 扩容规律

![](https://blog.meowrain.cn/api/i/2025/01/27/my5VWv1737969803395420365.avif)

## 切片作为参数

Go 语言的函数参数传递，只有值传递，没有引用传递，切片作为参数也是如此

我们来验证这一点

![](https://blog.meowrain.cn/api/i/2025/01/27/34ZRq21737970293711745015.avif)

```go
package main

import "fmt"

func main() {
 sl := []int{6, 6, 6}
 f(sl)
 fmt.Println(sl)
}

func f(sl []int) {
 for i := 0; i < 3; i++ {
  sl = append(sl, i)
 }
 fmt.Println(sl)
}

```

可以看到，输出的 sl 的值是不一样的，也就是说，f 函数没能修改主函数中的 sl 变量，而只是修改了形参 sl 变量的内容

当我们传递一个切片给函数的时候，函数接收到的其实是这个切片的一个副本，但是他们的 array 字段指向的是同一个底层数组。

这意味着，如果我们修改底层数组，是会影响到实参和形参的。

我们看下面的例子：形参通过改变底层数组影响实参

```go
package main

import "fmt"

func main() {
 sl := []int{6, 6, 6}
 f(sl)
 fmt.Println(sl)
}

func f(sl []int) {
 sl[1] = 1
 sl[2] = 2
}

```

![](https://blog.meowrain.cn/api/i/2025/01/27/f395pe1737970003488259606.avif)

### 通过指针传递影响实参

```go
package main

import "fmt"

func main() {
 sl := []int{6, 6, 6}
 f(&sl)
 fmt.Println(sl)
}

func f(sl *[]int) {
 *sl = append(*sl, 200)
}


```

![](https://blog.meowrain.cn/api/i/2025/01/27/igiBeJ1737970227764617103.avif)
